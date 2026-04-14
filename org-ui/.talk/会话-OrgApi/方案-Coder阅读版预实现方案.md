# Coder Agent 阅读版预实现方案 (OrgApi)

## 零、项目上下文与全局设定

1. **包位置**：所有代码必须存放在 `bsy-module-biz` 模块下的 `com.bossyun.module.biz.subject.org` 包中。
2. **依赖关系**：我们通过调用底层 `bsy-module-system` 的 `DeptService` 接口管理树形结构的增删改查。
3. **架构决定**：
   - **单体架构强事务**：未来不打算微服务和分库隔离，因此 `@Transactional` 足以保证主表和附表的事务一致性。
   - **无多租户**：剥离所有对 `tenant_id` 的处理，不需要 `TenantBaseDO`，直接继承 `BaseDO`。
   - **全量无分页**：因体量问题（千级别节点），所有获取列表的接口一律返回全量 `List`，不要使用分页 `PageResult`。
   - **数据权限说明**：内置的 `DataPermissionInterceptor` 会被弃用，后续改用编程式权限。当前保留代码中的 `accessControlApi.getDeptIds()` 获取权限，且针对框架原有拦截，通过 `@DataPermission(enable = false)` 绕过。

---

## 一、数据库与 DO (绝对红线)

**严禁建立独立树表**，必须采用 **1 对 1 附表扩展模式**。主表 `system_dept` 存储结构与名字，附表 `biz_org_extension` 存储多态业务字段。

### 1.1 附表 DDL
```sql
CREATE TABLE biz_org_extension (
    dept_id         BIGINT          PRIMARY KEY,    -- 逻辑关联 system_dept.id，由框架生成后赋值
    code            VARCHAR(64),                    -- 系统生成的组织编码，例如 ORG-xxxx
    org_type        VARCHAR(32)     NOT NULL,       -- SCHOOL | COLLEGE | MAJOR | CLASS | REGULAR_DEPT
    biz_line        VARCHAR(32),                    -- TEACHING | REGULAR | COMMON
    lifecycle_status VARCHAR(32),                   -- PREPARING | RUNNING | GRADUATED | STOPPED
    attributes      JSONB,                          -- PostgreSQL / MySQL JSON 类型
    creator         VARCHAR(64),
    create_time     DATETIME        NOT NULL,
    updater         VARCHAR(64),
    update_time     DATETIME        NOT NULL,
    deleted         TINYINT(1)      DEFAULT 0
);
CREATE INDEX idx_biz_org_ext_deleted ON biz_org_extension (deleted);
```

### 1.2 DO 设计 (`BizOrgExtDO`)
**红线：严禁创建 `OrgNode` 继承体系。DO 即内存缓存对象！**
```java
@TableName(value = "biz_org_extension", autoResultMap = true)
@Data
@EqualsAndHashCode(callSuper = true)
public class BizOrgExtDO extends BaseDO {
    @TableId(type = IdType.INPUT)
    private Long deptId;
    private String code;
    private String orgType;
    private String bizLine;
    private String lifecycleStatus;
    
    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> attributes;

    // --- 在 Cache.reload 时从 DeptDO 拷贝合并的瞬态字段 ---
    @TableField(exist = false) private Long parentId;
    @TableField(exist = false) private String name;
    @TableField(exist = false) private String path;
    @TableField(exist = false) private Integer sort;
    @TableField(exist = false) private Integer status; // 0开启 1停用
}
```

---

## 二、多态 VO 与消除魔法值 (严格约束)

### 2.1 基于 Jackson 的多态 VO
外部请求与响应必须利用 Jackson 的 `@JsonTypeInfo` 路由到具体子类，**严禁在 Controller 中写 if-else 分发**。
- **OrgSaveReqVO** (抽象父类) -> **ClassOrgSaveReqVO** (携带 `grade`, `eduLevel` 等)
- **OrgRespVO** (抽象父类) -> **ClassOrgRespVO**

### 2.2 消除字典 Key 魔法值
**红线：从 `attributes` Map 中 get/put 时，绝对禁止使用 `"grade"` 等手写字符串！**
利用 Lombok 生成常量：
```java
@Data
@EqualsAndHashCode(callSuper = true)
@FieldNameConstants  // <- 关键：Lombok 会生成内部类 Fields
public class ClassOrgSaveReqVO extends OrgSaveReqVO {
    @NotBlank(message = "年级不能为空")
    private String grade;
    @NotBlank(message = "培养层次不能为空")
    private String eduLevel;
}
```
在 `OrgConvert` 组装或读取 `attributes` 时，一律使用：`attrs.get(ClassOrgSaveReqVO.Fields.grade)`。

---

## 三、内存缓存与高速查询 (核心架构)

### 3.1 全局单例 Map
`OrgCache` 内部只需维护一个全局无锁快照：
`private final AtomicReference<Map<Long, BizOrgExtDO>> cacheRef;`
在 `reload()` 方法中，查出全量 `DeptDO` 和全量 `BizOrgExtDO`，在 Java 内存里 Left Join 并将 `DeptDO` 字段赋给 `@TableField(exist = false)` 属性，形成一棵扁平 Map。

### 3.2 同步机制
1. 写操作执行完后，立即发送 `OrgCacheRefreshMessage` 到 Redis。
2. 消费者收到消息后，直接触发 `OrgCache.reload()` 覆写原子引用。
3. 扫描表性能压力很小，暂时不需要引入复杂的节流（Debounce）或本地 Write-Through。

---

## 四、服务层查询策略 (必读指南)

`OrgServiceImpl` 必须提供以下几类纯粹的读取 API：

1. **查树（极速缓存读取）**：`getOrgTree(OrgTreeReqVO query)`
   - 先通过 `Stream` 过滤全局扁平 Map。
   - **必做逻辑**：对命中的节点执行“**父链路回溯（Bottom-Up）**”（基于 `path` 字符串 split 向上找所有祖先 ID，如 `0.1.5`）。
   - 将命中的节点及所有回溯出的祖先，按 `parentId` 在临时内存中组装成完整的嵌套树结构返回。

2. **平铺列表（极速缓存读取）**：`getOrgList(OrgListReqVO query)`
   - 直接 `Stream` 过滤全局缓存 Map 并 `map` 为 `VO` 返回。**无须**父链路回溯，**不**组装成树。

3. **严格直读 DB 列表（管理后台使用）**：`getOrgListDirect(OrgListReqVO query)`
   - 为管理后台强一致性场景使用，通过连查 DB 抛出，完全绕过缓存。

4. **严格直读 DB 单体（编辑回显使用）**：`getOrgDirect(Long id)`
   - 用于管理台点击“编辑”获取最新持久化状态。