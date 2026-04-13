# OrgApi 预实现方案

> 本文为可落地的编码指南，结合自然语言陈述 + 伪代码 + 注释。  
> 所有决策均已在前序 ADR 文档中确认，此处聚焦于「**如何写代码**」。

---

## 一、整体架构一览

```
┌──────────────────────────────────────────────────────────────┐
│  Controller  OrgController   ← Polymorphic VO (Jackson)      │
│  (admin-api/system/org)                                       │
├──────────────────────────────────────────────────────────────┤
│  Service     OrgServiceImpl                                   │
│              ├─ 写路径: DeptService (黑盒) + BizOrgExtMapper  │
│              ├─ 读路径(缓存): OrgCache.get(tenantId)         │
│              └─ 读路径(直读): DeptMapper + BizOrgExtMapper    │
├──────────────────────────────────────────────────────────────┤
│  Cache       OrgCache                                         │
│              ├─ 存储: AtomicReference<Map<Long,OrgNode>>     │
│              ├─ 初始化: @PostConstruct + ApplicationReady    │
│              └─ 失效: Redis Pub/Sub → OrgCacheRefreshConsumer│
├──────────────────────────────────────────────────────────────┤
│  DAL         system_dept (DeptDO)  +  biz_org_extension      │
└──────────────────────────────────────────────────────────────┘
```

关键约定：

- **写路径不绕过 `DeptService`**，树形结构 (`parentId`, `path`) 完全由底层维护。
- **读路径分两套**：高频展示走内存缓存（微秒级），管理维护页面走直读 DB（保证实时性）。
- **多态**在三层均有体现：DB 层 `attributes` JSONB，内存层 `OrgNode` 继承体系，API 层 Jackson `@JsonTypeInfo`。

---

## 二、包结构规划

> 实现放在 `bsy-module-biz` 模块下的 `subject` 业务包内，跨模块调用 system 的 DeptService。

```
com.bossyun.module.biz.subject.org
├── api                           // 给其他 biz 模块的接口
│   ├── OrgApi.java
│   └── dto
│       └── OrgNodeDTO.java
│
├── controller.admin
│   ├── OrgController.java
│   └── vo
│       ├── OrgSaveReqVO.java
│       ├── OrgRespVO.java
│       └── OrgTreeReqVO.java
│
├── dal
│   ├── dataobject
│   │   └── BizOrgExtDO.java
│   └── mysql
│       └── BizOrgExtMapper.java
│
├── service
│   ├── OrgService.java
│   ├── impl
│   │   └── OrgServiceImpl.java
│   ├── OrgCache.java
│   └── OrgConvert.java
│
└── mq
    ├── message
    │   └── OrgCacheRefreshMessage.java
    └── consumer
        └── OrgCacheRefreshConsumer.java
```

---

## 三、数据库设计

### 3.1 建表 DDL

```sql
-- 无需修改 system_dept，仅新增一张附表
CREATE TABLE biz_org_extension (
    dept_id         BIGINT          PRIMARY KEY,    -- FK → system_dept.id (逻辑外键)
    code            VARCHAR(64),                    -- 组织编码（业务编码，系统生成/手填，原型有展示）
    org_type        VARCHAR(32)     NOT NULL,       -- SCHOOL | COLLEGE | MAJOR | CLASS | REGULAR_DEPT
    biz_line        VARCHAR(32),                    -- COMMON | TEACHING | REGULAR
    lifecycle_status VARCHAR(32),                   -- PREPARING | RUNNING | GRADUATED(CLASS专属) | ARCHIVED
    
    -- 多态特有属性：CLASS 存 grade / edu_level; 其他类型可扩展
    -- 选用 JSONB (PG) 或 JSON (MySQL)；框架已有 JacksonTypeHandler 支持
    attributes      JSONB,
    
    -- BaseDO 标准字段（不再需要 tenant_id 多租户支持）
    creator         VARCHAR(64),
    create_time     DATETIME        NOT NULL,
    updater         VARCHAR(64),
    update_time     DATETIME        NOT NULL,
    deleted         TINYINT(1)      DEFAULT 0
);

-- 索引：全量加载时使用
CREATE INDEX idx_biz_org_ext_deleted ON biz_org_extension (deleted);
```

### 3.2 枚举定义

```java
// 与 MySQL/PG VARCHAR 对应，序列化为字符串而非数字
public enum OrgType {
    SCHOOL,       // 学校（根节点，通常只有一个）
    COLLEGE,      // 学院
    MAJOR,        // 专业
    CLASS,        // 班级（叶节点，不允许挂子节点）
    REGULAR_DEPT; // 普通行政部门（非教学线，如办公室、后勤部等）
    // 业务约束：CLASS / REGULAR_DEPT 下不允许挂子节点（在 Service 层校验）
}

public enum BizLine {
    COMMON,     // 通用线（SCHOOL 级别使用）
    TEACHING,   // 教学线
    REGULAR;    // 行政线
}

public enum OrgLifecycle {
    PREPARING,  // 筹建中
    RUNNING,    // 正常运行
    GRADUATED,  // 已毕业（CLASS 专属：班级毕业，数据留存，不再接受新操作）
    STOPPED;    // 停办（取代原本的 ARCHIVED，与前端UI原型对齐）
}
```

---

## 四、持久化层（DAL）

### 4.1 BizOrgExtDO — MyBatis-Plus 实体

```java
/**
 * 注意：此 DO 是"扁平记录"，不含多态子类分支。
 * 多态由 attributes 字段 + 内存层 OrgNode 体系承载。
 * 这样可以避免 MyBatis-Plus 无法原生处理继承映射的尴尬。
 */
@TableName(value = "biz_org_extension", autoResultMap = true)
@Data
@EqualsAndHashCode(callSuper = true)
public class BizOrgExtDO extends BaseDO {

    /** 与 system_dept.id 1:1 绑定，手动输入，不自增 */
    @TableId(type = IdType.INPUT)
    private Long deptId;

    private String code;            // 组织编码
    private String orgType;         // 存 OrgType.name()
    private String bizLine;         // 存 BizLine.name()，可为 null
    private String lifecycleStatus; // 存 OrgLifecycle.name()，可为 null

    /**
     * 多态特有属性的 JSON 包。
     * 由 OrgConvert 负责将强类型子类属性序列化进来，或读出时反序列化。
     * 示例 (CLASS): {"grade": "2024", "eduLevel": "BACHELOR"}
     */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> attributes;
}
```

### 4.2 BizOrgExtMapper

```java
@Mapper
public interface BizOrgExtMapper extends BaseMapperX<BizOrgExtDO> {

    /** 按 deptId 查单条（直读场景） */
    default BizOrgExtDO selectByDeptId(Long deptId) {
        return selectOne(BizOrgExtDO::getDeptId, deptId);
    }

    /**
     * 全量查询（缓存加载时使用）。
     * 注意：需要 @DataPermission(enable = false) 避免被权限拦截，
     * 因为缓存加载是系统级行为，不属于任何用户请求上下文。
     */
    @DataPermission(enable = false)
    default List<BizOrgExtDO> selectListAll() {
        return selectList(new LambdaQueryWrapperX<BizOrgExtDO>()
                .eq(BizOrgExtDO::getDeleted, false));
    }
}
```

---

## 五、内存缓存层

### 5.1 OrgNode — 内存多态树节点

```java
/**
 * 内存中的组织节点。
 * 继承体系仅供业务逻辑使用，不落库、不序列化到前端（前端走 OrgRespVO）。
 *
 * 设计取舍：
 *   - SCHOOL、COLLEGE、MAJOR、REGULAR_DEPT 目前无类型专属属性，共用 GenericOrgNode。
 *   - 只有 CLASS 需要 grade + eduLevel，单独一个子类 ClassOrgNode。
 *   - 若将来 COLLEGE / MAJOR 出现专属字段，可按需拆出子类，不影响现有代码。
 */
@Data
public abstract class OrgNode {
    private Long id;
    private Long parentId;
    private String name;
    private String code;        // 组织编码
    private String path;        // 来自 DeptDO，格式: "0.100.101"
    private Integer sort;
    private Integer status;     // CommonStatusEnum
    private OrgType orgType;
    private BizLine bizLine;
    private OrgLifecycle lifecycle;

    // 组装树时填充，非持久化字段
    @JsonIgnore
    private transient OrgNode parent;       // 指向父节点（内存中双向引用）
    private List<OrgNode> children = new ArrayList<>();
}

/**
 * 通用组织节点，覆盖 SCHOOL / COLLEGE / MAJOR / REGULAR_DEPT 这四种类型。
 * 这些类型目前无类型专属字段，用一个具体类表示，避免为每个类型创建空子类。
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class GenericOrgNode extends OrgNode { /* 暂无类型专属字段 */ }

@Data
@EqualsAndHashCode(callSuper = true)
@FieldNameConstants
public class ClassOrgNode extends OrgNode {
    private String grade;       // 入学年份，如 "2024"
    private String eduLevel;    // 培养层次：BACHELOR / MASTER / DOCTOR
}
```

### 5.2 OrgCache — 缓存管理器

```java
/**
 * 全量组织缓存，按租户隔离。
 *
 * 存储结构：
 *   tenantId → Map<deptId, OrgNode>（扁平，不含 children 引用，减少内存占用）
 *   children 关系在查询时按需组装（因为组装是 O(N) 的，且每次查询范围不同，无需缓存树形）
 *
 * 线程安全：
 *   AtomicReference<Map<Long, Map<Long, OrgNode>>> 保证读取时原子性。
 *   reload() 构建新 Map 后 CAS 替换，读操作不加锁（零等待）。
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class OrgCache {

    private final DeptMapper deptMapper;
    private final BizOrgExtMapper bizOrgExtMapper;
    private final OrgConvert orgConvert;
    // 注意：不依赖 TenantFrameworkService，不使用 TenantUtils.run()
    // 本系统无多租户需求，直接全量查询即可

    /**
     * key: deptId → OrgNode（全局扁平 Map，无租户隔离）
     * 用 AtomicReference 包装，保证换代时的原子性
     */
    private final AtomicReference<Map<Long, OrgNode>> cacheRef
            = new AtomicReference<>(Collections.emptyMap());

    // ==================== 初始化 ====================

    @PostConstruct
    public void init() {
        reload();
    }

    // ==================== 刷新 ====================

    /**
     * 全量重载：从 DB 拉取所有数据，重建缓存快照。
     * 由以下场景触发：
     *   1. 应用启动 (@PostConstruct)
     *   2. OrgCacheRefreshConsumer 收到 Redis Pub/Sub 消息
     */
    public synchronized void reload() {
        // 1. 全量查 DeptDO（@DataPermission(enable=false) 由 Mapper 层保证）
        List<DeptDO> depts = deptMapper.selectList(
                new LambdaQueryWrapperX<DeptDO>().eq(DeptDO::getDeleted, false));

        // 2. 全量查 BizOrgExtDO（已标注 @DataPermission(enable=false)）
        List<BizOrgExtDO> exts = bizOrgExtMapper.selectListAll();

        // 3. 在 Java 内存中 Left Join（O(N)）
        Map<Long, BizOrgExtDO> extMap = CollectionUtils.convertMap(exts, BizOrgExtDO::getDeptId);
        Map<Long, OrgNode> nodeMap = new HashMap<>(depts.size());
        for (DeptDO dept : depts) {
            BizOrgExtDO ext = extMap.get(dept.getId());
            // 若 ext 为 null，说明是纯系统部门（未关联业务），跳过
            if (ext == null) continue;
            OrgNode node = orgConvert.toNode(dept, ext);
            nodeMap.put(node.getId(), node);
        }

        // 4. 原子替换
        cacheRef.set(Collections.unmodifiableMap(nodeMap));
        log.info("[OrgCache][reload] 完成，共加载 {} 个组织节点", nodeMap.size());
    }

    // ==================== 查询 ====================

    /**
     * 获取全量扁平 NodeMap（只读视图）。
     * 调用方用此 Map 进行权限裁剪 + 条件过滤 + 树组装。
     */
    public Map<Long, OrgNode> getNodeMap() {
        return cacheRef.get();
    }

    /** 快捷方法：按 deptId 取单节点 */
    public Optional<OrgNode> getNode(Long deptId) {
        return Optional.ofNullable(cacheRef.get().get(deptId));
    }
}
```

### 5.3 Redis Pub/Sub 刷新机制

```java
// ---- 消息体（无多租户，全量刷新即可）----
public class OrgCacheRefreshMessage extends AbstractRedisChannelMessage {
    // 留空即可
}

// ---- 消费者 ----
@Component
@RequiredArgsConstructor
public class OrgCacheRefreshConsumer
        extends AbstractRedisChannelMessageListener<OrgCacheRefreshMessage> {

    private final OrgCache orgCache;

    @Override
    public void onMessage(OrgCacheRefreshMessage message) {
        log.info("[OrgCacheRefreshConsumer] 收到组织缓存刷新信号");
        orgCache.reload(); // 触发无分页全量加载
    }
}

// ---- 写操作后发布消息（在 OrgServiceImpl 中）----
redisMQTemplate.send(new OrgCacheRefreshMessage());
```

---

## 六、服务层

### 6.1 OrgService 接口设计

```java
public interface OrgService {

    // ==================== 写操作 ====================

    /**
     * 创建组织节点。
     * cmd 为多态类型，CLASS 时携带 grade/eduLevel，其余类型字段为空。
     * 内部：先调用 DeptService.createDept() 获取 deptId，再插入 biz_org_extension。
     */
    Long createOrg(OrgSaveReqVO cmd);

    /**
     * 更新组织节点。
     * 不允许修改 orgType（类型变更需删除重建，防止数据不一致）。
     */
    void updateOrg(OrgSaveReqVO cmd);

    /**
     * 删除组织节点。
     * 前置校验：若有子节点，禁止删除（提示先删除子节点）。
     * 若 orgType=CLASS，额外校验：若有在读学生，禁止删除（由调用方传入校验钩子，OrgService 不直接依赖学生服务）。
     */
    void deleteOrg(Long id);

    // ==================== 读操作（缓存） ====================

    /**
     * 获取当前租户的完整组织树（含权限裁剪 + 业务过滤 + 父链路补全）。
     * 这是最核心的查询方法，支撑前端「组织树展示」场景。
     */
    List<OrgRespVO> getOrgTree(OrgTreeReqVO query);

    /**
     * 获取满足条件的 orgId 列表（不含树结构）。
     * 用于「作为下游查询入参」场景（如：查询某班级的学生列表）。
     * 直接返回严格交集（权限 ∩ 筛选条件），不补全父链路。
     */
    List<Long> getOrgIdList(OrgListReqVO query);

    // ==================== 读操作（直读，非缓存） ====================

    /**
     * 直读单个组织节点（用于编辑回显、详情页）。
     * 绕过缓存，直接查 DB，保证看到最新状态。
     */
    OrgRespVO getOrgDirect(Long id);

    /**
     * 直读组织列表（无分页）。
     * 支持数据权限拦截（走 @DataPermission）。
     */
    List<OrgRespVO> getOrgListDirect(OrgListReqVO query);
}
```

### 6.2 OrgServiceImpl 核心实现伪代码

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class OrgServiceImpl implements OrgService {

    private final DeptService deptService;          // system 底层，写路径代理
    private final BizOrgExtMapper bizOrgExtMapper;  // 附表读写
    private final OrgCache orgCache;                // 内存缓存
    private final OrgConvert orgConvert;            // DO ↔ VO 转换
    private final RedisMQTemplate redisMQTemplate;  // 发布缓存刷新消息
    private final AccessControlApi accessControlApi;// 数据权限

    // ======================== 写操作 ========================

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long createOrg(OrgSaveReqVO cmd) {
        // Step 1: 校验父节点合法性（如 CLASS 节点的父必须是 MAJOR）
        validateParent(cmd.getParentId(), cmd.getOrgType());

        // Step 2: 构建 DeptSaveReqVO 调用底层，获取自动生成的 deptId
        DeptSaveReqVO deptReq = orgConvert.toDeptSaveReq(cmd);
        Long deptId = deptService.createDept(deptReq);
        // 底层自动处理：id 生成、path 拼装、parentId 校验

        // Step 3: 构建 BizOrgExtDO 插入附表
        BizOrgExtDO extDO = orgConvert.toExtDO(deptId, cmd);
        bizOrgExtMapper.insert(extDO);

        // Step 4: 广播缓存刷新
        publishCacheRefresh();
        return deptId;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateOrg(OrgSaveReqVO cmd) {
        // Step 1: 确认节点存在且 orgType 未变更
        OrgNode existing = orgCache.getNode(cmd.getId())
                .orElseThrow(() -> exception(ORG_NOT_EXISTS));
        if (existing.getOrgType() != cmd.getOrgType()) {
            throw exception(ORG_TYPE_CANNOT_CHANGE);
        }

        // Step 2: 更新 system_dept（基础信息）
        deptService.updateDept(orgConvert.toDeptSaveReq(cmd));

        // Step 3: 更新附表
        BizOrgExtDO extDO = orgConvert.toExtDO(cmd.getId(), cmd);
        bizOrgExtMapper.updateById(extDO);

        publishCacheRefresh();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteOrg(Long id) {
        // Step 0: 校验不能删除学校（根节点）
        OrgNode node = orgCache.getNode(id).orElseThrow(() -> exception(ORG_NOT_EXISTS));
        if (node.getOrgType() == OrgType.SCHOOL) {
            throw exception(ORG_ROOT_CANNOT_DELETE);
        }

        // Step 1: 校验无子节点
        long childCount = deptService.getChildDeptList(id).size();
        if (childCount > 0) {
            throw exception(ORG_HAS_CHILDREN);
        }

        // Step 2: 删除附表（先删业务侧，避免外键悬空）
        bizOrgExtMapper.deleteById(id);

        // Step 3: 删除底层 dept（底层会处理自己的 @CacheEvict）
        deptService.deleteDept(id);

        publishCacheRefresh();
    }

    // ======================== 读操作（缓存，复杂查询核心） ========================

    @Override
    public List<OrgRespVO> getOrgTree(OrgTreeReqVO query) {
        // 1. 获取全局缓存只读快照（O(1)，无锁）
        Map<Long, OrgNode> allNodes = orgCache.getNodeMap();
        if (allNodes.isEmpty()) {
            return Collections.emptyList();
        }

        // 2. 数据权限裁剪：获取当前用户允许访问的 deptId 集合
        // 返回 null 表示超级管理员（不限制），返回空集合表示没有任何权限
        Set<Long> allowedIds = accessControlApi.getDeptIds(ORG_QUERY_PERMISSION);
        if (allowedIds != null && allowedIds.isEmpty()) {
            return Collections.emptyList();
        }

        // 3. 第一层过滤：求交集（权限 ∩ 业务多维过滤条件）
        // 筛选出**直接命中**条件的节点（例如：名称包含"软件"、或者是"2024级"的班级）
        List<OrgNode> matchedNodes = allNodes.values().stream()
                .filter(n -> allowedIds == null || allowedIds.contains(n.getId()))
                .filter(n -> matchesQuery(n, query))
                .collect(Collectors.toList());

        if (matchedNodes.isEmpty()) {
            return Collections.emptyList();
        }

        // 4. 第二层回溯：补全父链路（Bottom-Up），防止树断层
        // 如果只返回命中节点（如班级），前端无法渲染完整的层级（学校->学院->专业->班级）
        // 因此必须把命中节点的所有祖先也捞出来，形成完整的路径
        Set<Long> resultIds = new HashSet<>(matchedNodes.size() * 2);
        for (OrgNode node : matchedNodes) {
            resultIds.add(node.getId());
            addAncestors(node, allNodes, resultIds); 
        }

        // 5. 第三层构建：将扁平的 resultIds 转为嵌套的多态 VO 树
        return buildTreeVO(resultIds, allNodes);
    }

    @Override
    public List<Long> getOrgIdList(OrgListReqVO query) {
        // 获取全局快照与权限集合
        Map<Long, OrgNode> allNodes = orgCache.getNodeMap();
        Set<Long> allowedIds = accessControlApi.getDeptIds(ORG_QUERY_PERMISSION);

        // 严格模式（常用于给外部微服务提供参数，例如查询某专业下的所有学生）：
        // 这里不需要补全父链路，只需精确返回命中条件的节点 ID
        return allNodes.values().stream()
                .filter(n -> allowedIds == null || allowedIds.contains(n.getId()))
                .filter(n -> matchesQuery(n, query))
                .map(OrgNode::getId)
                .collect(Collectors.toList());
    }

        // --- Step 4: 从 allNodes 中取出 resultIds 对应的节点，组装成树 ---
        // 组装：先 Map.get(id) 取扁平列表，再按 parentId 建立 children 关系
        return buildTreeVO(resultIds, allNodes);
    }

    @Override
    public List<Long> getOrgIdList(OrgListReqVO query) {
        Map<Long, OrgNode> allNodes = orgCache.getNodeMap();
        Set<Long> allowedIds = accessControlApi.getDeptIds(ORG_QUERY_PERMISSION);

        // 严格模式：权限 ∩ 筛选条件，直接返回 ID 列表，不补父链路
        return allNodes.values().stream()
                .filter(n -> allowedIds == null || allowedIds.contains(n.getId()))
                .filter(n -> matchesQuery(n, query))
                .map(OrgNode::getId)
                .collect(Collectors.toList());
    }

    // ======================== 读操作（直读） ========================

    @Override
    @DataPermission(enable = false) // 编辑回显不走数据权限（已在 Controller 层做了节点归属校验）
    public OrgRespVO getOrgDirect(Long id) {
        DeptDO dept = deptService.getDept(id);
        if (dept == null) throw exception(ORG_NOT_EXISTS);
        BizOrgExtDO ext = bizOrgExtMapper.selectByDeptId(id);
        OrgNode node = orgConvert.toNode(dept, ext);
        return orgConvert.toRespVO(node);
    }

    // ======================== 私有工具 ========================

    private void publishCacheRefresh() {
        redisMQTemplate.send(new OrgCacheRefreshMessage());
    }

    /**
     * 利用 DeptDO.path 字段向上追溯祖先（避免递归查询内存 Map）。
     * path 格式: "0.100.101.103" → split('.') 得到所有祖先 ID
     */
    private void addAncestors(OrgNode node, Map<Long, OrgNode> allNodes, Set<Long> resultIds) {
        if (node.getPath() == null) return;
        for (String part : node.getPath().split(PATH_SEPARATOR)) {
            long ancestorId = Long.parseLong(part);
            if (ancestorId == VIRTUAL_ROOT_ID) continue; // 跳过虚拟根节点
            if (allNodes.containsKey(ancestorId)) {
                resultIds.add(ancestorId);
            }
        }
    }

    private boolean matchesQuery(OrgNode node, OrgTreeReqVO q) {
        // 支持前端的原型多选查询和模糊查询
        if (CollUtil.isNotEmpty(q.getTypes()) && !q.getTypes().contains(node.getOrgType())) return false;
        if (CollUtil.isNotEmpty(q.getBizLines()) && !q.getBizLines().contains(node.getBizLine())) return false;
        if (CollUtil.isNotEmpty(q.getLifecycles()) && !q.getLifecycles().contains(node.getLifecycle())) return false;
        
        if (StrUtil.isNotBlank(q.getKeyword())) {
            boolean nameMatch = node.getName() != null && node.getName().contains(q.getKeyword());
            boolean codeMatch = node.getCode() != null && node.getCode().contains(q.getKeyword());
            if (!nameMatch && !codeMatch) return false;
        }

        // CLASS 特有：grade / eduLevel 多选筛选
        if (node instanceof ClassOrgNode classNode) {
            if (CollUtil.isNotEmpty(q.getGrades()) && !q.getGrades().contains(classNode.getGrade())) return false;
            if (CollUtil.isNotEmpty(q.getEduLevels()) && !q.getEduLevels().contains(classNode.getEduLevel())) return false;
        } else {
            // 原型：若勾选了年级/培养层次，则只过滤班级（也可在 Controller 验证，或直接过滤掉非班级节点）
            // 这里我们保持宽容：如果过滤条件带了 CLASS 专有属性，非 CLASS 节点如果作为父链路本身会被保留
        }
        return true;
    }

    private List<OrgRespVO> buildTreeVO(Set<Long> resultIds, Map<Long, OrgNode> allNodes) {
        // 1. 取出所有目标节点
        List<OrgNode> nodes = resultIds.stream()
                .map(allNodes::get)
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(OrgNode::getSort))
                .collect(Collectors.toList());

        // 2. 按 parentId 建立 children（在临时 Map 中操作，不污染缓存中的节点）
        Map<Long, OrgRespVO> voMap = new LinkedHashMap<>();
        for (OrgNode n : nodes) {
            voMap.put(n.getId(), orgConvert.toRespVO(n)); // children 初始为空
        }
        List<OrgRespVO> roots = new ArrayList<>();
        for (OrgRespVO vo : voMap.values()) {
            OrgRespVO parent = voMap.get(vo.getParentId());
            if (parent != null) {
                parent.getChildren().add(vo);
            } else {
                roots.add(vo); // 父节点不在结果集中，视为根
            }
        }
        return roots;
    }
}
```

---

## 七、API 层（Controller）

### 7.1 多态 VO 设计

```java
// ===================== Request VO（输入，多态） =====================

/**
 * 使用 use=NAME + property="type" 驱动多态。
 * 前端 POST body 示例（创建班级）：
 * {
 *   "type": "CLASS",
 *   "parentId": 201,
 *   "name": "计算机2024-1班",
 *   "sort": 1,
 *   "grade": "2024",
 *   "eduLevel": "BACHELOR"
 * }
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type", visible = true)
@JsonSubTypes({
    @JsonSubTypes.Type(value = GenericOrgSaveReqVO.class,  name = "SCHOOL"),
    @JsonSubTypes.Type(value = GenericOrgSaveReqVO.class,  name = "COLLEGE"),
    @JsonSubTypes.Type(value = GenericOrgSaveReqVO.class,  name = "MAJOR"),
    @JsonSubTypes.Type(value = GenericOrgSaveReqVO.class,  name = "REGULAR_DEPT"),
    @JsonSubTypes.Type(value = ClassOrgSaveReqVO.class,    name = "CLASS"),
})
@Data
public abstract class OrgSaveReqVO {
    private Long id;          // 更新时必填，创建时为空
    @NotNull
    private Long parentId;
    @NotBlank
    private String name;
    private String code;      // 系统自动生成或手填的编码
    @NotNull
    private Integer sort;
    @NotNull
    private Integer status;   // CommonStatusEnum
    private OrgType orgType;  // 由 @JsonTypeInfo 的 visible=true 自动填充
    private BizLine bizLine;
    private OrgLifecycle lifecycle;
}

@Data
@EqualsAndHashCode(callSuper = true)
public class ClassOrgSaveReqVO extends OrgSaveReqVO {
    @NotBlank(message = "年级不能为空")
    private String grade;
    @NotBlank(message = "培养层次不能为空")
    private String eduLevel;
}

// ===================== Response VO（输出，多态） =====================

@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type", visible = true)
@JsonSubTypes({
    @JsonSubTypes.Type(value = GenericOrgRespVO.class,  name = "SCHOOL"),
    @JsonSubTypes.Type(value = GenericOrgRespVO.class,  name = "COLLEGE"),
    @JsonSubTypes.Type(value = GenericOrgRespVO.class,  name = "MAJOR"),
    @JsonSubTypes.Type(value = GenericOrgRespVO.class,  name = "REGULAR_DEPT"),
    @JsonSubTypes.Type(value = ClassOrgRespVO.class,    name = "CLASS"),
})
@Data
public abstract class OrgRespVO {
    private Long id;
    private Long parentId;
    private String name;
    private String code;
    private Integer sort;
    private Integer status;
    private OrgType orgType;
    private BizLine bizLine;
    private OrgLifecycle lifecycle;
    private List<OrgRespVO> children = new ArrayList<>(); // 树结构时填充
}

@Data
@EqualsAndHashCode(callSuper = true)
public class ClassOrgRespVO extends OrgRespVO {
    private String grade;
    private String eduLevel;
}
```

### 7.2 OrgController

```java
@RestController
@RequestMapping("/admin-api/system/org")
@Tag(name = "管理后台 - 组织架构")
@Validated
@RequiredArgsConstructor
public class OrgController {

    private final OrgService orgService;

    // ---- 树形查询（缓存，高频）----

    @GetMapping("/tree")
    @Operation(summary = "获取组织树（支持多维度筛选，补全父链路）")
    @PreAuthorize("@ss.hasPermission('system:org:query')")
    public CommonResult<List<OrgRespVO>> getOrgTree(OrgTreeReqVO query) {
        return success(orgService.getOrgTree(query));
    }

    // ---- 管理 CRUD ----

    @GetMapping("/{id}")
    @Operation(summary = "获取单个组织节点（直读，用于编辑回显）")
    @PreAuthorize("@ss.hasPermission('system:org:query')")
    public CommonResult<OrgRespVO> getOrg(@PathVariable Long id) {
        return success(orgService.getOrgDirect(id));
    }

    @PostMapping
    @Operation(summary = "创建组织节点")
    @PreAuthorize("@ss.hasPermission('system:org:create')")
    @OperateLog(type = CREATE)
    public CommonResult<Long> createOrg(@Valid @RequestBody OrgSaveReqVO req) {
        // Jackson 自动反序列化为 ClassOrgSaveReqVO / CollegeOrgSaveReqVO 等子类
        return success(orgService.createOrg(req));
    }

    @PutMapping
    @Operation(summary = "更新组织节点")
    @PreAuthorize("@ss.hasPermission('system:org:update')")
    @OperateLog(type = UPDATE)
    public CommonResult<Boolean> updateOrg(@Valid @RequestBody OrgSaveReqVO req) {
        orgService.updateOrg(req);
        return success(true);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除组织节点")
    @PreAuthorize("@ss.hasPermission('system:org:delete')")
    @OperateLog(type = DELETE)
    public CommonResult<Boolean> deleteOrg(@PathVariable Long id) {
        orgService.deleteOrg(id);
        return success(true);
    }

    // ---- 直读列表（非缓存，管理维护场景）----

    @GetMapping("/list")
    @Operation(summary = "获取组织列表（直读DB，无分页）")
    @PreAuthorize("@ss.hasPermission('system:org:query')")
    public CommonResult<List<OrgRespVO>> getOrgListDirect(OrgListReqVO query) {
        return success(orgService.getOrgListDirect(query));
    }
}
```

---

## 八、OrgConvert — 转换器设计

```java
/**
 * 职责：
 *   1. DeptDO + BizOrgExtDO  → OrgNode (具体子类，按 orgType dispatch)
 *   2. OrgSaveReqVO           → DeptSaveReqVO + BizOrgExtDO
 *   3. OrgNode                → OrgRespVO (具体子类)
 *
 * 采用手写 Convert 而非 MapStruct，原因：
 *   - OrgNode 和 OrgRespVO 有多态分支，MapStruct 对 abstract 类支持有限
 *   - 逻辑分支较多（attributes 的解包），手写更清晰
 */
@Component
public class OrgConvert {

    public OrgNode toNode(DeptDO dept, BizOrgExtDO ext) {
        OrgType orgType = OrgType.valueOf(ext.getOrgType());
        OrgNode node = switch (orgType) {
            case SCHOOL, COLLEGE, MAJOR, REGULAR_DEPT -> new GenericOrgNode();
            case CLASS    -> {
                ClassOrgNode n = new ClassOrgNode();
                // 从 JSONB attributes Map 中解包强类型字段
                // 使用 Lombok 的 @FieldNameConstants 自动生成的常量，彻底告别手写魔法字符串！
                Map<String, Object> attrs = ext.getAttributes();
                if (attrs != null) {
                    n.setGrade((String) attrs.get(ClassOrgNode.Fields.grade));
                    n.setEduLevel((String) attrs.get(ClassOrgNode.Fields.eduLevel));
                }
                yield n;
            }
        };
        // 填充公共字段
        node.setId(dept.getId());
        node.setParentId(dept.getParentId());
        node.setName(dept.getName());
        node.setCode(ext.getCode());
        node.setPath(dept.getPath());
        node.setSort(dept.getSort());
        node.setStatus(dept.getStatus());
        node.setOrgType(orgType);
        node.setBizLine(ext.getBizLine() != null ? BizLine.valueOf(ext.getBizLine()) : null);
        node.setLifecycle(ext.getLifecycleStatus() != null
                ? OrgLifecycle.valueOf(ext.getLifecycleStatus()) : null);
        return node;
    }

    public OrgRespVO toRespVO(OrgNode node) {
        // 按运行时类型 dispatch
        return switch (node.getOrgType()) {
            case SCHOOL, COLLEGE, MAJOR, REGULAR_DEPT -> fillCommon(new GenericOrgRespVO(), node);
            case CLASS    -> {
                ClassOrgRespVO vo = (ClassOrgRespVO) fillCommon(new ClassOrgRespVO(), node);
                ClassOrgNode cn = (ClassOrgNode) node;
                vo.setGrade(cn.getGrade());
                vo.setEduLevel(cn.getEduLevel());
                yield vo;
            }
        };
    }

    private OrgRespVO fillCommon(OrgRespVO vo, OrgNode node) {
        vo.setId(node.getId());
        vo.setParentId(node.getParentId());
        vo.setName(node.getName());
        vo.setCode(node.getCode());
        vo.setSort(node.getSort());
        vo.setStatus(node.getStatus());
        vo.setOrgType(node.getOrgType());
        vo.setBizLine(node.getBizLine());
        vo.setLifecycle(node.getLifecycle());
        return vo;
    }

    public DeptSaveReqVO toDeptSaveReq(OrgSaveReqVO cmd) {
        DeptSaveReqVO req = new DeptSaveReqVO();
        req.setId(cmd.getId());
        req.setParentId(cmd.getParentId());
        req.setName(cmd.getName());
        req.setSort(cmd.getSort());
        req.setStatus(cmd.getStatus());
        return req;
    }

    public BizOrgExtDO toExtDO(Long deptId, OrgSaveReqVO cmd) {
        BizOrgExtDO ext = new BizOrgExtDO();
        ext.setDeptId(deptId);
        ext.setCode(cmd.getCode());
        ext.setOrgType(cmd.getOrgType().name());
        ext.setBizLine(cmd.getBizLine() != null ? cmd.getBizLine().name() : null);
        ext.setLifecycleStatus(cmd.getLifecycle() != null ? cmd.getLifecycle().name() : null);

        // 将子类特有字段打包进 attributes Map
        if (cmd instanceof ClassOrgSaveReqVO classCmd) {
            Map<String, Object> attrs = new HashMap<>();
            attrs.put(ClassOrgNode.Fields.grade, classCmd.getGrade());
            attrs.put(ClassOrgNode.Fields.eduLevel, classCmd.getEduLevel());
            ext.setAttributes(attrs);
        }
        return ext;
    }
}
```

---

## 九、数据权限集成说明

### 9.1 无需额外配置的部分

由于我们的 OrgNode 在 `system_dept` 中以普通行存在，框架中 `DataPermissionConfiguration` 已注册：

```java
rule.addDeptColumn(DeptDO.class, "id"); // system_dept.id 受数据权限保护
```

因此，当我们的**直读 API** 通过 `DeptMapper` 查询时，框架的 MyBatis 拦截器会自动追加 `WHERE id IN (...)` 条件，无需任何额外配置。

### 9.2 缓存读取的权限处理

缓存路径是我们**主动调用** `accessControlApi.getDeptIds("system:org:query")` 来拿到允许的 deptId 集合，然后在 Java 内存中做 filter。这样既避免了对数据库的依赖，又精确地执行了权限裁剪。

### 9.3 缓存加载时必须关闭数据权限

`OrgCache.reload()` 是系统级操作，必须绕过数据权限（否则可能因为 SecurityContext 为空而失败，或缓存内容不完整）。解决方案：
- `BizOrgExtMapper.selectListByTenantId()` 标注 `@DataPermission(enable = false)`
- `DeptMapper` 查询时，使用 `TenantUtils.run()` 包裹，内部开一个无权限上下文

---

## 十、关键设计决策备忘

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 内存缓存 vs DB 查询 | JVM 全量缓存 | 高校节点数 < 5000，微秒级响应，彻底解放 DB |
| 缓存同步机制 | Redis Pub/Sub (`OrgCacheRefreshMessage`) | 框架已有 `AbstractRedisChannelMessageListener`，几十行代码搞定 |
| 多态表示 | Jackson `@JsonTypeInfo` + `OrgNode` 继承体系 | 编译期类型安全，无 `Map<String,Object>` 蔓延 |
| 是否绕过 DeptService 写库 | 否，全部走 DeptService | 0 侵入，数据权限天然适配 |
| 是否提供直读 API | 是，`getOrgDirect` / `getOrgListDirect` | 保证编辑回显实时性，管理页分页 |
| attributes 字段类型 | `Map<String,Object>` (DB 侧) + 强类型子类 (内存/API 侧) | DB 侧灵活扩展，业务侧强类型 |
| 是否支持 CLASS 类型约束 | 是 (`validateParent()` 方法) | CLASS 下不允许挂子节点，SCHOOL 只能在根下 |

---

## 十一、实现优先级与顺序

1. **DDL + BizOrgExtDO + BizOrgExtMapper** （先建好基础，可以跑通 CRUD）
2. **枚举：OrgType / BizLine / OrgLifecycle**
3. **OrgNode 继承体系**（SCHOOL / COLLEGE / MAJOR / CLASS）
4. **OrgConvert**（`toNode()` / `toRespVO()` / `toExtDO()`）
5. **OrgCache** + **OrgCacheRefreshMessage** + **OrgCacheRefreshConsumer**
6. **OrgService 接口 + OrgServiceImpl**（先实现写操作，再实现缓存读取）
7. **OrgSaveReqVO / OrgRespVO（多态 VO）**
8. **OrgController**
9. **OrgApi（跨模块接口）**（最后，等 Service 稳定后暴露）
