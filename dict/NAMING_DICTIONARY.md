# 术语字典：学生全面发展教育 / 学校活动参与信息

> 说明：以下命名以“五育/全面发展教育”场景为准，优先保证业务语义清晰、适合接口/数据库/前端字段落地。

| 中文术语 | 推荐英文名 | 推荐代码命名 | 含义 | 适用场景 | 命名理由 | 不推荐命名 | 常识度 |
|---|---|---|---|---|---|---|---|
| 五育活动 | HolisticEducationActivity | `HolisticEduActivity` | 面向学生全面发展教育的活动 | 活动列表、活动详情、活动发布 | “五育”本质是全面发展教育维度下的活动，不建议直用 `FiveEducation` | `FiveEducationActivity`、`ActivityType` | 中 |
| 五育类型 | HolisticEducationDimension | `HolisticEduDim` | 活动归属的育人维度（德、智、体、美、劳） | 筛选条件、分类标签、统计维度 | 这里表达的是“维度/类别”，不是泛泛的 `Type` | `FiveEducationType`、`Type` | 中 |
| 德育 | MoralEducation | `moralEducation` | 德育维度 | 五育类型选项 | 直观明确，符合教育语境 | `VirtueEducation` | 高 |
| 智育 | IntellectualEducation | `intellectualEducation` | 智育维度 | 五育类型选项 | 语义清晰，适合系统字段 | `WisdomEducation` | 高 |
| 体育 | PhysicalEducation | `physicalEducation` | 体育维度 | 五育类型选项 | 约定俗成，最易理解 | `SportsEducation` | 高 |
| 美育 | AestheticEducation | `aestheticEducation` | 美育维度 | 五育类型选项 | 常用正式表达 | `ArtEducation` | 高 |
| 劳育 | LaborEducation | `laborEducation` | 劳动教育维度 | 五育类型选项 | 教育领域常用说法 | `WorkEducation` | 高 |
| 活动发布 | ActivityPublish | `activityPublish` | 发布活动的操作或模块 | 活动发布页、发布动作 | 明确是“发布”动作，不只是活动本身 | `PublishActivity`（动词式可作按钮文案） | 高 |
| 活动审核 | ActivityApproval | `activityApproval` | 活动审核流程或审核页 | 审核列表、审核详情 | 明确属于审批流程 | `ReviewActivity`、`AuditActivity` | 高 |
| 活动状态 | ActivityLifecycleStatus | `activityLifecycleStatus` | 活动当前所处时间状态 | 待开始、进行中、已结束 | 这里是活动生命周期状态，不是审核状态 | `Status`、`ActivityStatus` | 中 |
| 活动层级 | ActivityScope | `activityScope` | 活动适用的组织层级 | 班级、院级、校级 | “层级”在这里更接近覆盖范围/组织范围 | `ActivityLevel`（可接受但略泛） | 中 |
| 活动类型 | ActivityCategory | `activityCategory` | 按组织方/发文单位划分的活动分类 | 国家级、省级、市级等 | 这里更像分类，不建议笼统用 `Type` | `ActivityType` | 中 |
| 活动名称 | ActivityName | `activityName` | 活动标题 | 列表、详情、搜索 | 标准字段命名 | `Name` | 高 |
| 主办单位 | Organizer | `organizer` | 活动发起或主办机构 | 列表、详情、发布表单 | 低歧义，通用性强 | `HostUnit`、`SponsorUnit` | 高 |
| 负责人 | PersonInCharge | `personInCharge` | 活动责任人 | 表单、详情、筛选 | 表达明确，适合联系人字段 | `Owner`、`Leader` | 高 |
| 联系电话 | ContactPhone | `contactPhone` | 负责人联系电话 | 表单、详情 | 常见且清晰 | `Phone` | 高 |
| 参与人数 | ParticipantCount | `participantCount` | 活动参与总人数 | 列表统计、详情 | 直接表达计数含义 | `JoinCount`、`PeopleCount` | 高 |
| 签到码 | CheckInCode | `checkInCode` | 活动签到使用的验证码/二维码码值 | 签到页面、签到入口 | 明确用于签到，不建议仅写 `Code` | `AttendanceCode`（可作别名） | 高 |
| 审核状态 | ApprovalStatus | `approvalStatus` | 活动审核流程状态 | 待审核、已通过、已驳回、审核中 | 必须明确是审批状态，而不是活动状态 | `Status` | 高 |
| 待审核 | PendingApproval | `pendingApproval` | 审核流程未完成 | 审核状态枚举值 | 简洁明确 | `ToBeReviewed` | 高 |
| 审核中 | UnderReview | `underReview` | 正在审核 | 审核状态枚举值 | 符合常用表达 | `Reviewing` | 高 |
| 已通过 | Approved | `approved` | 审核通过 | 审核状态枚举值 | 最常见的审批结果命名 | `Pass` | 高 |
| 已驳回 | Rejected | `rejected` | 审核未通过 | 审核状态枚举值 | 常规审批结果命名 | `Refused` | 高 |
| 无需审核 | NoApprovalRequired | `noApprovalRequired` | 不需要走审批流程 | 发布状态/审核配置 | 语义完整，避免误解 | `NoReview` | 中 |
| 已回收 | Withdrawn | `withdrawn` | 活动被撤回/回收，不再继续发布 | 发布回收、重新发布 | 比“已回收”更接近业务动作结果 | `Recycled` | 中 |
| 重新发布 | Republish | `republish` | 将被回收或驳回的活动再次发布 | 操作按钮 | 简洁准确 | `PublishAgain` | 高 |
| 活动详情 | ActivityDetail | `activityDetail` | 活动详情页或详情信息 | 详情页、抽屉、弹窗 | 标准详情命名 | `Detail` | 高 |
| 活动编辑 | ActivityEdit | `activityEdit` | 编辑活动信息 | 编辑页、编辑弹窗 | 明确是编辑动作 | `EditActivity` | 高 |
| 活动删除 | ActivityDelete | `activityDelete` | 删除活动 | 列表操作、详情操作 | 语义直接 | `DeleteActivity` | 高 |
| 活动导出 | ActivityExport | `activityExport` | 导出活动数据 | 列表导出、统计导出 | 适合操作按钮与接口名 | `Export` | 高 |
| 活动签到 | CheckIn | `checkIn` | 学生进入活动后的签到动作 | 签到入口、签到按钮 | 比 `SignIn` 更贴近校园活动场景 | `SignIn` | 高 |
| 签到记录 | CheckInRecord | `checkInRecord` | 学生签到的记录明细 | 签到明细、统计报表 | 与签到动作保持一致 | `AttendanceRecord` | 高 |
| 参与名单 | ParticipantList | `participantList` | 参与活动的学生名单 | 名单页、名单导出 | 清晰表达名单范围 | `JoinList` | 高 |
| 参与状态 | ParticipationStatus | `participationStatus` | 学生是否参与、签到、缺席等结果状态 | 学生参与信息、统计 | 比单独写 `Status` 更明确 | `Status` | 中 |
| 报名 | Registration | `registration` | 学生报名活动的行为或结果 | 报名入口、报名记录 | 若业务包含报名流程，建议独立定义 | `Apply` | 高 |
| 报名状态 | RegistrationStatus | `registrationStatus` | 报名流程状态 | 已报名、已取消、已审核 | 明确是报名流程状态 | `ApplyStatus` | 高 |
| 已报名 | Registered | `registered` | 已完成报名 | 报名状态枚举值 | 常规且易懂 | `Applied` | 高 |
| 已取消 | Cancelled | `cancelled` | 取消报名或参与 | 报名状态枚举值 | 通用状态表达 | `Canceled` | 高 |

## 学生行为主题术语

| 中文术语 | 推荐英文名 | 推荐代码命名 | 含义 | 适用场景 | 命名理由 | 不推荐命名 | 常识度 |
|---|---|---|---|---|---|---|---|
| 学生行为 | StudentBehavior | `studentBehavior` | 学生在学习/生活中的行为记录总称 | 行为管理、行为统计、行为画像 | 覆盖正负向行为，不限定具体事件 | `Behavior`、`StudentAction` | 高 |
| 行为记录 | BehaviorRecord | `behaviorRecord` | 单条学生行为事件或记录 | 行为明细、台账、审计 | 强调可追溯的记录对象 | `Record` | 高 |
| 正向行为 | PositiveBehavior | `positiveBehavior` | 有利于学生发展、应被记录的正向行为 | 评优、奖项、职务、表现、任务 | 可作为正向总类，不限定具体子类 | `GoodBehavior` | 中 |
| 负向行为 | NegativeBehavior | `negativeBehavior` | 需要记录的负面行为 | 违纪、异常、预警 | 直接表达对立面，便于统计 | `BadBehavior` | 中 |
| 评优评先 | Commendation | `commendation` | 获得表彰、荣誉、先进评定 | 荣誉登记、行为加分 | 比 `Award` 更适合作为“评优”总称 | `Honor`、`Recognition` | 中 |
| 赛事奖项 | CompetitionAward | `competitionAward` | 竞赛或赛事中获得的奖项 | 比赛获奖、比赛成果 | 将赛事和奖项合并，贴合学生成长记录 | `ContestAward` | 高 |
| 担任职务 | StudentPosition | `studentPosition` | 学生在组织中担任的职务 | 班委、社团干部、学生干部 | “职务”比“岗位”更贴近校园 | `Post`、`Duty` | 高 |
| 日常表现 | DailyPerformance | `dailyPerformance` | 学生日常学习生活表现 | 课堂、宿舍、纪律、活动表现 | 适合作为日常观察类记录 | `RoutinePerformance` | 中 |
| 学期任务 | SemesterTask | `semesterTask` | 学期内要求完成的任务或目标 | 学期目标、任务达成 | 与学期周期直接关联 | `TermTask` | 高 |
| 行为类别 | BehaviorCategory | `behaviorCategory` | 行为记录的归类标签 | 统计筛选、台账分类 | 作为总分类字段更稳妥 | `BehaviorType` | 中 |
| 行为得分 | BehaviorScore | `behaviorScore` | 行为对应的分值 | 加减分、综合评价 | 适合量化评价体系 | `Score` | 高 |
| 行为备注 | BehaviorRemark | `behaviorRemark` | 行为记录补充说明 | 详情、表单备注 | 作为补充说明字段清晰自然 | `Remark` | 高 |
| 行为来源 | BehaviorSource | `behaviorSource` | 行为记录的来源渠道 | 手工录入、系统导入、活动生成 | 便于区分数据来源 | `Source` | 高 |
| 行为时间 | BehaviorTime | `behaviorTime` | 行为发生时间 | 记录时间、统计时间轴 | 表达直观 | `Time` | 高 |

## 基础信息与学校体系术语

| 中文术语 | 推荐英文名 | 推荐代码命名 | 含义 | 适用场景 | 命名理由 | 不推荐命名 | 常识度 |
|---|---|---|---|---|---|---|---|
| 学生基本信息 | StudentProfile | `studentProfile` | 学生的基础档案信息 | 学生档案、详情页 | 用 `Profile` 比 `Info` 更适合结构化档案 | `StudentInfo` | 高 |
| 学生姓名 | StudentName | `studentName` | 学生姓名 | 表单、详情、搜索 | 标准字段命名 | `Name` | 高 |
| 学号 | StudentNumber | `studentNumber` | 学生唯一学籍编号/校内编号 | 学生档案、名单 | 避免直接用 `No` | `StudentNo` | 高 |
| 学生班级 | StudentClass | `studentClass` | 学生所在班级 | 学生档案、筛选 | 避免直接使用 `Class` | `Class` | 高 |
| 所在学院 | College | `college` | 学生/教师所属学院 | 组织归属、筛选 | 教育场景中清晰常用 | `Department`（若学校内部叫法一致也可） | 高 |
| 所在专业 | Major | `major` | 学生所属专业 | 学生档案、统计 | 通用且明确 | `Specialty` | 高 |
| 年级 | GradeLevel | `gradeLevel` | 学生所在年级 | 筛选、统计 | 比单独用 `Grade` 更明确 | `Grade` | 高 |
| 入学年份 | EnrollmentYear | `enrollmentYear` | 学生入学年份 | 学籍、分级统计 | 直接表达入学时间 | `Year` | 高 |
| 教师基本信息 | TeacherProfile | `teacherProfile` | 教师基础档案信息 | 教师档案、人员管理 | 与学生档案保持一致 | `TeacherInfo` | 高 |
| 教师姓名 | TeacherName | `teacherName` | 教师姓名 | 表单、详情 | 标准字段命名 | `Name` | 高 |
| 工号 | StaffNumber | `staffNumber` | 教师/教职工编号 | 人员管理、登录绑定 | 比 `JobNumber` 更通用 | `TeacherNo` | 高 |
| 学校行政体系 | SchoolOrganization | `schoolOrganization` | 学校内部组织体系总称 | 学院、部门、处室、班级关系 | 覆盖行政与管理结构 | `AdministrativeSystem` | 中 |
| 学校 | School | `school` | 学校主体机构 | 学校档案、租户信息 | 最基础且明确 | `Institution`（可作上位词） | 高 |
| 校区 | Campus | `campus` | 学校的物理校区 | 多校区管理 | 标准教育场景术语 | `Area` | 高 |
| 学院 | CollegeOrganization | `collegeOrganization` | 学院级组织 | 组织架构、归属管理 | 避免与普通学校“学院”混淆时可加限定 | `CollegeDept` | 中 |
| 部门 | Department | `department` | 行政部门或职能部门 | 组织架构、权限归属 | 通用低歧义 | `Section` | 高 |
| 班级 | StudentClass | `studentClass` | 学生所在班级组织 | 班级管理、名单管理 | 避免 `Class` 保留字风险 | `Class` | 高 |
| 全面发展教育 | HolisticEducation | `holisticEducation` | 面向学生德智体美劳全面发展的教育体系 | 项目总域、首页标识、统计口径 | 比直译“五育”更稳定、可扩展 | `FiveEducation` | 中 |
| 五育目标 | HolisticEducationGoal | `holisticEducationGoal` | 全面发展教育的目标项 | 目标管理、指标配置 | 适合指标化落地 | `FiveEducationGoal` | 中 |
| 五育指标 | HolisticEducationMetric | `holisticEducationMetric` | 全面发展教育的统计或考核指标 | 统计面板、考核体系 | `Metric` 比 `Index` 更自然 | `FiveEducationIndex` | 中 |
| 五育统计 | HolisticEducationStatistics | `holisticEducationStatistics` | 全面发展教育相关统计汇总 | 数据看板、报表 | 语义完整 | `FiveEducationStatistics` | 中 |
| 五育画像 | HolisticEducationPortrait | `holisticEducationPortrait` | 学生五育发展画像 | 学生画像、能力雷达图 | `Portrait` 是教育/分析语境常用说法 | `FiveEducationPortrait` | 中 |

## 口径说明

- “五育活动”建议作为业务域名称使用，不建议直接拆成 `五育 + 活动` 两层泛词。
- “活动状态”与“活动审核”应分开：前者描述时间/生命周期，后者描述审批流程。
- “活动类型”如果实际枚举值是国家级、省级、市级等，更接近“分类/级别”，后续若业务允许，建议统一改为 `ActivityCategory` 或 `ActivityGrade`。

## 本页推荐的核心字段

- `holisticEducationActivity`
- `holisticEducationDimension`
- `activityLifecycleStatus`
- `approvalStatus`
- `participantCount`
- `checkInCode`
