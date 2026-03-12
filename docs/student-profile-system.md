# PathMind AI - 学生画像系统设计

## 系统概述

学生画像系统通过多维度数据采集和分析，为每个学生构建全面的学习档案，帮助教师、运营人员和学生本人了解学习状态和进步情况。

## 核心指标模型

### 1. 实验完成度 (Experiment Completion)

**定义**: 学生已完成的实验数量占总实验数量的比例

**计算公式**:
```
实验完成度 = 已完成实验数 / 总实验数
```

**数据来源**:
- `student_experiments` 表中 `status = 'completed'` 的记录

**权重**: 30%

**等级划分**:
- 优秀: ≥ 0.9
- 良好: 0.7 - 0.89
- 中等: 0.5 - 0.69
- 需提升: < 0.5

### 2. 知识点掌握率 (Knowledge Mastery)

**定义**: 学生已掌握的知识点数量占目标知识点总数的比例

**计算公式**:
```
知识点掌握率 = 掌握度 ≥ 0.7 的知识点数 / 目标知识点总数
```

**掌握度计算**:
```
单个知识点掌握度 = (正确练习次数 / 总练习次数) * 时间衰减因子

时间衰减因子 = e^(-λ * 距离上次练习天数)
其中 λ = 0.01 (衰减系数)
```

**数据来源**:
- `student_knowledge_mastery` 表
- `student_experiments` 表 (通过实验关联的知识点)

**权重**: 30%

**等级划分**:
- 精通: ≥ 0.9
- 熟练: 0.7 - 0.89
- 掌握: 0.5 - 0.69
- 学习中: < 0.5

### 3. 学习活跃度 (Learning Activity)

**定义**: 学生在一定时间段内的学习频率和持续性

**计算公式**:
```
学习活跃度 = 近30天学习天数 / 30

学习天数定义: 当天有学习记录(观看课程、做实验、查看资料等)
```

**数据来源**:
- `learning_records` 表
- 统计 `created_at` 字段的不同日期数

**权重**: 20%

**等级划分**:
- 非常活跃: ≥ 0.8 (24天+)
- 活跃: 0.6 - 0.79 (18-23天)
- 一般: 0.4 - 0.59 (12-17天)
- 不活跃: < 0.4 (< 12天)

### 4. 实验正确率 (Experiment Accuracy)

**定义**: 学生首次提交实验的正确率

**计算公式**:
```
实验正确率 = 首次提交正确的实验数 / 已完成实验总数
```

**数据来源**:
- `student_experiments` 表
- `is_correct = true AND submission_count = 1`

**权重**: 20%

**等级划分**:
- 优秀: ≥ 0.9
- 良好: 0.7 - 0.89
- 中等: 0.5 - 0.69
- 需提升: < 0.5

### 5. 综合评分 (Overall Score)

**计算公式**:
```
综合评分 = 实验完成度 * 0.3
         + 知识点掌握率 * 0.3
         + 学习活跃度 * 0.2
         + 实验正确率 * 0.2
```

**等级划分**:
- S 级: ≥ 0.9
- A 级: 0.8 - 0.89
- B 级: 0.7 - 0.79
- C 级: 0.6 - 0.69
- D 级: < 0.6

## 扩展指标

### 6. 学习时长统计

**指标**:
- 总学习时长 (小时)
- 日均学习时长 (分钟)
- 周学习时长趋势
- 月学习时长趋势

**数据来源**:
- `learning_records.duration`
- `student_experiments.duration`

### 7. 学习效率

**定义**: 单位时间内的学习成果

**计算公式**:
```
学习效率 = (完成实验数 * 平均实验难度系数) / 总学习时长

难度系数:
- beginner: 1.0
- intermediate: 1.5
- advanced: 2.0
```

### 8. 进步速度

**定义**: 一段时间内综合评分的增长率

**计算公式**:
```
进步速度 = (本月综合评分 - 上月综合评分) / 上月综合评分
```

### 9. 知识图谱覆盖度

**定义**: 学生在知识图谱中的覆盖范围

**计算**:
- 已学习的知识点类别数
- 知识深度 (最深学习路径层级)
- 知识广度 (覆盖的知识领域数)

### 10. 协作能力

**指标**:
- 参与讨论次数
- 帮助他人次数
- 团队项目贡献度

## 数据采集点

### 前端埋点

```typescript
// 学习行为追踪
interface LearningEvent {
  studentId: string
  eventType: 'view' | 'start' | 'complete' | 'pause' | 'resume'
  resourceType: 'course' | 'experiment' | 'material' | 'video'
  resourceId: string
  duration?: number // 秒
  timestamp: Date
}

// 实验提交追踪
interface ExperimentSubmission {
  studentId: string
  experimentId: string
  submissionCount: number
  isCorrect: boolean
  score: number
  duration: number // 分钟
  timestamp: Date
}

// 知识点练习追踪
interface KnowledgePractice {
  studentId: string
  knowledgePointId: string
  isCorrect: boolean
  timestamp: Date
}
```

### 后端数据处理

```go
// 实时更新学生画像
func (s *AnalyticsService) UpdateStudentProfile(ctx context.Context, event LearningEvent) error {
    // 1. 记录学习行为
    if err := s.learningRepo.CreateRecord(ctx, event); err != nil {
        return err
    }

    // 2. 更新知识点掌握度
    if event.EventType == "complete" && event.ResourceType == "experiment" {
        if err := s.updateKnowledgeMastery(ctx, event.StudentId, event.ResourceId); err != nil {
            return err
        }
    }

    // 3. 异步更新画像缓存
    go s.refreshProfileCache(event.StudentId)

    return nil
}
```

## 可视化展示

### 学生端 - 个人成长档案

**雷达图** (六边形):
- 实验完成度
- 知识点掌握率
- 学习活跃度
- 实验正确率
- 学习效率
- 进步速度

**时间轴**:
- 学习时长趋势 (折线图)
- 实验完成数量 (柱状图)
- 综合评分变化 (面积图)

**知识图谱**:
- 已掌握知识点 (绿色节点)
- 学习中知识点 (黄色节点)
- 未学习知识点 (灰色节点)
- 推荐学习路径 (高亮路径)

**成就系统**:
- 徽章: 连续学习7天、完成10个实验、掌握50个知识点
- 排行榜: 班级排名、年级排名
- 里程碑: 学习100小时、完成所有基础实验

### 教师端 - 班级学习概况

**班级整体指标**:
```
┌─────────────────────────────────────────┐
│ 班级: 计算机科学 2024-1 班              │
│ 学生数: 45 人                           │
├─────────────────────────────────────────┤
│ 平均实验完成率: 78.5%                   │
│ 平均知识点掌握率: 65.3%                 │
│ 平均学习活跃度: 72.1%                   │
│ 平均实验正确率: 81.2%                   │
│ 班级综合评分: 74.3 (B 级)               │
└─────────────────────────────────────────┘
```

**学生分布**:
- 综合评分分布 (直方图)
- 学习活跃度分布 (饼图)
- 实验完成进度 (进度条列表)

**预警学生**:
- 学习活跃度 < 0.4 的学生
- 实验完成率 < 0.5 的学生
- 近7天无学习记录的学生

**优秀学生**:
- 综合评分 Top 10
- 进步最快 Top 5
- 学习时长 Top 5

### 运营端- 多维度报表

**教师授课统计**:
- 各教师班级平均成绩
- 教学资源使用率
- 学生满意度评分

**资源应用分析**:
- 课程完成率排行
- 实验难度分布
- 知识点热度图

**学生学习数据**:
- 日活跃用户数 (DAU)
- 周活跃用户数 (WAU)
- 月活跃用户数 (MAU)
- 平均学习时长趋势
- 实验提交量趋势

**数据导出**:
- Excel 报表导出
- PDF 报告生成
- 数据 API 接口

## 数据库查询优化

### 索引策略

```sql
-- 学习记录查询优化
CREATE INDEX idx_learning_records_student_date
ON learning_records(student_id, created_at DESC);

-- 实验记录查询优化
CREATE INDEX idx_student_experiments_student_status
ON student_experiments(student_id, status, completed_at);

-- 知识点掌握度查询优化
CREATE INDEX idx_knowledge_mastery_student_level
ON student_knowledge_mastery(student_id, mastery_level DESC);
```

### 物化视图

```sql
-- 学生画像物化视图 (每小时刷新)
CREATE MATERIALIZED VIEW student_profile_summary AS
SELECT
    s.id as student_id,
    s.student_number,
    u.username,
    COUNT(DISTINCT CASE WHEN se.status = 'completed' THEN se.id END)::float /
        NULLIF((SELECT COUNT(*) FROM experiments), 0) as experiment_completion,
    COUNT(DISTINCT CASE WHEN skm.mastery_level >= 0.7 THEN skm.knowledge_point_id END)::float /
        NULLIF((SELECT COUNT(*) FROM knowledge_points), 0) as knowledge_mastery,
    COUNT(DISTINCT DATE(lr.created_at))::float / 30 as learning_activity,
    COUNT(DISTINCT CASE WHEN se.is_correct AND se.submission_count = 1 THEN se.id END)::float /
        NULLIF(COUNT(DISTINCT CASE WHEN se.status = 'completed' THEN se.id END), 0) as experiment_accuracy,
    SUM(lr.duration) / 60 as total_learning_hours
FROM students s
JOIN users u ON s.user_id = u.id
LEFT JOIN student_experiments se ON s.id = se.student_id
LEFT JOIN learning_records lr ON s.id = lr.student_id AND lr.created_at >= NOW() - INTERVAL '30 days'
LEFT JOIN student_knowledge_mastery skm ON s.id = skm.student_id
GROUP BY s.id, s.student_number, u.username;

-- 刷新策略
CREATE INDEX ON student_profile_summary(student_id);
REFRESH MATERIALIZED VIEW CONCURRENTLY student_profile_summary;
```

### 缓存策略

```go
// Redis 缓存键设计
const (
    StudentProfileKey = "student:profile:%s"           // 学生画像
    ClassOverviewKey  = "class:overview:%s"            // 班级概况
    LeaderboardKey    = "leaderboard:class:%s"         // 班级排行榜
    CacheTTL          = 1 * time.Hour                  // 缓存过期时间
)

// 缓存更新策略
func (s *AnalyticsService) GetStudentProfile(ctx context.Context, studentID uuid.UUID) (*models.StudentProfile, error) {
    // 1. 尝试从缓存获取
    cacheKey := fmt.Sprintf(StudentProfileKey, studentID)
    if cached, err := s.cache.Get(ctx, cacheKey); err == nil {
        var profile models.StudentProfile
        if err := json.Unmarshal([]byte(cached), &profile); err == nil {
            return &profile, nil
        }
    }

    // 2. 从数据库计算
    profile, err := s.calculateStudentProfile(ctx, studentID)
    if err != nil {
        return nil, err
    }

    // 3. 写入缓存
    if data, err := json.Marshal(profile); err == nil {
        s.cache.Set(ctx, cacheKey, string(data), CacheTTL)
    }

    return profile, nil
}
```

## API 接口设计

### 学生端 API

```
GET /api/v1/student/profile
响应:
{
  "student_id": "uuid",
  "experiment_completion": 0.85,
  "knowledge_mastery": 0.72,
  "learning_activity": 0.68,
  "experiment_accuracy": 0.91,
  "total_learning_hours": 120,
  "overall_score": 0.79,
  "level": "B",
  "rank_in_class": 5,
  "rank_in_grade": 23
}

GET /api/v1/student/learning-records?days=30
响应:
{
  "records": [
    {
      "date": "2025-02-14",
      "duration": 120,
      "experiments_completed": 2,
      "courses_viewed": 3
    }
  ],
  "total_duration": 3600,
  "total_experiments": 45,
  "total_courses": 12
}

GET /api/v1/student/knowledge-map
响应:
{
  "nodes": [
    {
      "id": "python",
      "name": "Python",
      "mastery_level": 0.85,
      "status": "mastered"
    }
  ],
  "edges": [...],
  "recommended_path": ["python", "ml-basics", "deep-learning"]
}
```

### 教师端 API

```
GET /api/v1/teacher/class/:classId/overview
响应:
{
  "class_id": "uuid",
  "class_name": "计算机科学 2024-1 班",
  "student_count": 45,
  "avg_experiment_completion": 0.785,
  "avg_knowledge_mastery": 0.653,
  "avg_learning_activity": 0.721,
  "avg_experiment_accuracy": 0.812,
  "overall_score": 0.743,
  "level": "B"
}

GET /api/v1/teacher/class/:classId/students?sort=overall_score&order=desc
响应:
{
  "students": [
    {
      "student_id": "uuid",
      "student_number": "2024001",
      "username": "张三",
      "overall_score": 0.92,
      "level": "S",
      "rank": 1
    }
  ],
  "total": 45,
  "page": 1,
  "page_size": 20
}

GET /api/v1/teacher/class/:classId/alerts
响应:
{
  "inactive_students": [...],      // 不活跃学生
  "low_completion_students": [...], // 完成率低学生
  "struggling_students": [...]      // 学习困难学生
}
```

### 运营端 API

```
GET /api/v1/operator/reports/learning?start_date=2025-01-01&end_date=2025-02-14
响应:
{
  "total_students": 1200,
  "active_students": 980,
  "avg_learning_hours": 85,
  "total_experiments_completed": 45000,
  "daily_active_users": [...],
  "weekly_trends": [...]
}

GET /api/v1/operator/reports/teachers
响应:
{
  "teachers": [
    {
      "teacher_id": "uuid",
      "name": "李老师",
      "class_count": 3,
      "student_count": 135,
      "avg_class_score": 0.78,
      "resource_usage_rate": 0.85
    }
  ]
}

GET /api/v1/operator/reports/resources
响应:
{
  "courses": [
    {
      "course_id": "uuid",
      "name": "Python 编程基础",
      "completion_rate": 0.82,
      "avg_rating": 4.5,
      "total_learners": 850
    }
  ],
  "experiments": [...],
  "knowledge_points": [...]
}
```

## 实施优先级

### P0 (核心功能 - 2周)
- 学生画像基础指标计算
- 学生端个人成长档案页面
- 数据采集埋点

### P1 (重要功能 - 3周)
- 教师端班级概况
- 实验统计分析
- 缓存优化

### P2 (增强功能 - 2周)
- 运营端多维度报表
- 知识图谱可视化
- 排行榜系统

### P3 (扩展功能 - 2周)
- 成就系统
- 预警机制
- 数据导出

## 性能目标

- 学生画像查询响应时间: < 100ms
- 班级概况查询响应时间: < 200ms
- 报表生成时间: < 3s
- 支持并发用户数: > 1000
- 数据准确率: > 99.9%
