# 组织架构管理 API 设计方案 (多态架构版)

## 1. 设计理念 (Design Philosophy)
基于“优雅、灵活、简洁”的原则，为了避免API爆炸，我们坚持**单一路由入口**。同时，为了避免松散的 `Map` 导致类型安全丧失和代码可读性下降，本设计采用 **面向对象的多态 (Polymorphism)** 结合 Jackson 的 `@JsonTypeInfo` 特性：
- **统一路由 (Unified Routing)**：所有的组织操作（增删改查）均通过 `/api/v1/organizations` 暴露，不按类型拆分Controller。
- **多态反序列化 (Polymorphic Deserialization)**：利用 `@JsonTypeInfo` 和 `@JsonSubTypes`，前端只需在 JSON 中传入 `type` 字段，Spring Boot 即可自动将其映射为对应的强类型 Java 子类（如 `ClassOrgCmd`），享受编译期检查和 IDE 提示。
- **单表继承策略 (Single Table Inheritance)**：在持久层（如 JPA / MyBatis Plus），建议采用单表策略存储所有组织节点，通过 `type` 作为鉴别器列 (Discriminator Column)，特有字段（如 `eduLevel`）仅对特定类型生效，其他类型留空或存在扩展 JSON 列中。

## 2. 数据结构 (Data Structures)

### 2.1 核心枚举 (Enums)
```java
public enum OrgType {
    SCHOOL, COLLEGE, MAJOR, CLASS, REGULAR_DEPT
}

public enum BizLine {
    TEACHING, REGULAR, COMMON
}

public enum OrgStatus {
    PREPARING, RUNNING, GRADUATED, STOPPED
}
```

### 2.2 多态 DTO 与 Cmd (Polymorphic DTOs & Commands)

**Base DTO (基础响应对象)**
```java
@Data
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME, 
    include = JsonTypeInfo.As.EXISTING_PROPERTY, 
    property = "type",
    visible = true
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = SchoolOrgDTO.class, name = "SCHOOL"),
    @JsonSubTypes.Type(value = CollegeOrgDTO.class, name = "COLLEGE"),
    @JsonSubTypes.Type(value = MajorOrgDTO.class, name = "MAJOR"),
    @JsonSubTypes.Type(value = ClassOrgDTO.class, name = "CLASS"),
    @JsonSubTypes.Type(value = RegularDeptOrgDTO.class, name = "REGULAR_DEPT")
})
public abstract class OrgDTO {
    private String id;
    private String parentId;
    private String name;
    private String code;
    private OrgType type;
    private BizLine bizLine;
    private OrgStatus status;
    
    // 树形结构
    private List<OrgDTO> children;
}
```

**特定子类 (Subclasses)**
```java
@Data
@EqualsAndHashCode(callSuper = true)
public class ClassOrgDTO extends OrgDTO {
    // 班级特有属性，强类型约束
    private String eduLevel;
    private String grade;
}

@Data
@EqualsAndHashCode(callSuper = true)
public class SchoolOrgDTO extends OrgDTO {
    // 暂无特有属性，但保留扩展点
}
```

**Base Cmd (基础保存/更新命令)**
```java
@Data
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME, 
    include = JsonTypeInfo.As.EXISTING_PROPERTY, 
    property = "type",
    visible = true
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = ClassOrgSaveCmd.class, name = "CLASS"),
    // 其他子类...
})
public abstract class OrgSaveCmd {
    @NotBlank(message = "组织名称不能为空")
    private String name;
    
    private String parentId;
    
    @NotNull(message = "组织类型不能为空")
    private OrgType type;
    
    @NotNull(message = "业务线不能为空")
    private BizLine bizLine;
    
    @NotNull(message = "状态不能为空")
    private OrgStatus status;
}

@Data
@EqualsAndHashCode(callSuper = true)
public class ClassOrgSaveCmd extends OrgSaveCmd {
    @NotBlank(message = "培养层次不能为空")
    private String eduLevel;
    
    @NotBlank(message = "年级不能为空")
    private String grade;
}
```

## 3. 接口契约 (RESTful API)

### 3.1 获取组织列表/树 (GET)
**`GET /api/v1/organizations`**
- **功能**: 支持多条件过滤。通过 `asTree=true` 决定返回嵌套还是平铺。
- **返回**: `Result<List<OrgDTO>>` （List 内元素可以是混搭的子类对象，Jackson 会自动带有 `type` 标示并且渲染正确的特有字段）。

### 3.2 创建组织 (POST)
**`POST /api/v1/organizations`**
- **功能**: 创建新节点。
- **请求体**: `OrgSaveCmd`。Spring MVC 会根据 JSON 里的 `"type": "CLASS"`，自动将 body 映射并校验为 `ClassOrgSaveCmd` 的实例，触发 `eduLevel` 和 `grade` 的 `@NotBlank` 校验。
- **返回**: `Result<String>` (返回新生成的主键 ID)

### 3.3 更新组织 (PUT)
**`PUT /api/v1/organizations/{id}`**
- **功能**: 全量/增量更新组织信息。
- **请求体**: `OrgSaveCmd`
- **返回**: `Result<Void>`

## 4. 架构设计的优雅与灵活体现
1. **多态的强类型检查 (Strong Typing)**：摒弃了容易出错且无 IDE 提示的松散 Map。使用 Jackson 的类型推导，让 JSON 反序列化完美衔接 Java 面向对象的多态性。
2. **校验精准 (Precise Validation)**：由于多态路由到了具体的 Cmd 子类，可以在 `ClassOrgSaveCmd` 上打特定的 Validation 注解（例如只要求班级填写 `grade`），而无需在 Service 里写各种 if-else 来判断特定 type 应该校验什么字段。
3. **接口收敛 (API Convergence)**：尽管内部模型有多态，外部表现仍是一套标准的 `GET/POST/PUT /organizations` 接口，满足了不“堆砌膨胀”的要求。
