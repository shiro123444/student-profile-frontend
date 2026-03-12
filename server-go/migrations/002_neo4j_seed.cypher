-- Create MBTI Type nodes
CREATE (m1:MBTIType {code: 'INTJ', name: '建筑师', description: '富有想象力和战略性的思想家，一切皆在计划之中。'})
CREATE (m2:MBTIType {code: 'INTP', name: '逻辑学家', description: '具有创新精神的发明家，对知识有着止不住的渴望。'})
CREATE (m3:MBTIType {code: 'ENTJ', name: '指挥官', description: '大胆、富有想象力且意志强大的领导者，总能找到或创造解决方法。'})
CREATE (m4:MBTIType {code: 'ENTP', name: '辩论家', description: '聪明好奇的思想家，不会放过任何智力上的挑战。'})
CREATE (m5:MBTIType {code: 'INFJ', name: '提倡者', description: '安静而神秘，同时鼓舞人心且不知疲倦的理想主义者。'})
CREATE (m6:MBTIType {code: 'INFP', name: '调停者', description: '诗意、善良的利他主义者，总是热情地为正义事业提供帮助。'})
CREATE (m7:MBTIType {code: 'ENFJ', name: '主人公', description: '富有魅力鼓舞人心的领导者，有使听众着迷的能力。'})
CREATE (m8:MBTIType {code: 'ENFP', name: '竞选者', description: '热情、有创造力、社交能力强的自由精神，总能找到理由微笑。'})
CREATE (m9:MBTIType {code: 'ISTJ', name: '物流师', description: '实际且注重事实的个人，可靠性不容怀疑。'})
CREATE (m10:MBTIType {code: 'ISFJ', name: '守卫者', description: '非常专注而温暖的守护者，时刻准备保护爱着的人们。'})
CREATE (m11:MBTIType {code: 'ESTJ', name: '总经理', description: '出色的管理者，在管理事情或人的时候无与伦比。'})
CREATE (m12:MBTIType {code: 'ESFJ', name: '执政官', description: '极有同情心、受欢迎、总是热心帮助他人的人。'})
CREATE (m13:MBTIType {code: 'ISTP', name: '鉴赏家', description: '大胆而实际的实验家，擅长使用各种工具。'})
CREATE (m14:MBTIType {code: 'ISFP', name: '探险家', description: '灵活有魅力的艺术家，时刻准备探索和体验新事物。'})
CREATE (m15:MBTIType {code: 'ESTP', name: '企业家', description: '聪明、精力充沛善于感知的人们，真心享受生活在边缘。'})
CREATE (m16:MBTIType {code: 'ESFP', name: '表演者', description: '自发的、精力充沛和热情的表演者——生活在他们周围永远不会无聊。'})

-- Create Career nodes
CREATE (c1:Career {id: 'software-engineer', name: '软件工程师', description: '设计、开发和维护软件系统', salary: '15-40万', growth: '高'})
CREATE (c2:Career {id: 'data-scientist', name: '数据科学家', description: '分析和解释复杂数据以帮助决策', salary: '20-50万', growth: '高'})
CREATE (c3:Career {id: 'product-manager', name: '产品经理', description: '规划和管理产品开发生命周期', salary: '20-60万', growth: '高'})
CREATE (c4:Career {id: 'ux-designer', name: 'UX设计师', description: '设计用户体验和界面', salary: '15-35万', growth: '中'})
CREATE (c5:Career {id: 'teacher', name: '教师', description: '教育和培养学生', salary: '8-20万', growth: '稳定'})
CREATE (c6:Career {id: 'psychologist', name: '心理咨询师', description: '提供心理健康咨询和治疗', salary: '10-30万', growth: '中'})
CREATE (c7:Career {id: 'entrepreneur', name: '创业者', description: '创建和管理自己的企业', salary: '不定', growth: '高风险高回报'})
CREATE (c8:Career {id: 'researcher', name: '科研人员', description: '进行科学研究和实验', salary: '12-40万', growth: '中'})

-- Create Skill nodes
CREATE (s1:Skill {name: 'Python编程'})
CREATE (s2:Skill {name: 'Java编程'})
CREATE (s3:Skill {name: 'JavaScript'})
CREATE (s4:Skill {name: '数据分析'})
CREATE (s5:Skill {name: '机器学习'})
CREATE (s6:Skill {name: '项目管理'})
CREATE (s7:Skill {name: '用户研究'})
CREATE (s8:Skill {name: '沟通能力'})
CREATE (s9:Skill {name: '领导力'})
CREATE (s10:Skill {name: '创造力'})

-- Create Course nodes
CREATE (course1:Course {id: 'python-basics', name: 'Python基础教程', provider: 'Coursera', duration: '4周', difficulty: 'beginner', rating: 4.8})
CREATE (course2:Course {id: 'data-science-intro', name: '数据科学入门', provider: 'edX', duration: '6周', difficulty: 'intermediate', rating: 4.7})
CREATE (course3:Course {id: 'product-management', name: '产品管理实战', provider: 'Udemy', duration: '8周', difficulty: 'intermediate', rating: 4.6})
CREATE (course4:Course {id: 'ux-design-fundamentals', name: 'UX设计基础', provider: 'Coursera', duration: '5周', difficulty: 'beginner', rating: 4.9})

-- Create LearningPath nodes
CREATE (lp1:LearningPath {id: 'software-engineer-path', name: '软件工程师学习路径', description: '从零基础到软件工程师', estimatedDuration: '6个月'})
CREATE (lp2:LearningPath {id: 'data-scientist-path', name: '数据科学家学习路径', description: '成为数据科学专家', estimatedDuration: '8个月'})
CREATE (lp3:LearningPath {id: 'product-manager-path', name: '产品经理学习路径', description: '产品管理全栈技能', estimatedDuration: '4个月'})

-- Create MBTI -> Career relationships (SUITS)
MATCH (m:MBTIType {code: 'INTJ'}), (c:Career {id: 'software-engineer'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'INTJ'}), (c:Career {id: 'data-scientist'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'INTJ'}), (c:Career {id: 'researcher'}) CREATE (m)-[:SUITS]->(c)

MATCH (m:MBTIType {code: 'INTP'}), (c:Career {id: 'software-engineer'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'INTP'}), (c:Career {id: 'data-scientist'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'INTP'}), (c:Career {id: 'researcher'}) CREATE (m)-[:SUITS]->(c)

MATCH (m:MBTIType {code: 'ENTJ'}), (c:Career {id: 'product-manager'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'ENTJ'}), (c:Career {id: 'entrepreneur'}) CREATE (m)-[:SUITS]->(c)

MATCH (m:MBTIType {code: 'ENTP'}), (c:Career {id: 'entrepreneur'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'ENTP'}), (c:Career {id: 'product-manager'}) CREATE (m)-[:SUITS]->(c)

MATCH (m:MBTIType {code: 'INFJ'}), (c:Career {id: 'psychologist'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'INFJ'}), (c:Career {id: 'teacher'}) CREATE (m)-[:SUITS]->(c)

MATCH (m:MBTIType {code: 'INFP'}), (c:Career {id: 'ux-designer'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'INFP'}), (c:Career {id: 'teacher'}) CREATE (m)-[:SUITS]->(c)

MATCH (m:MBTIType {code: 'ENFJ'}), (c:Career {id: 'teacher'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'ENFJ'}), (c:Career {id: 'product-manager'}) CREATE (m)-[:SUITS]->(c)

MATCH (m:MBTIType {code: 'ENFP'}), (c:Career {id: 'ux-designer'}) CREATE (m)-[:SUITS]->(c)
MATCH (m:MBTIType {code: 'ENFP'}), (c:Career {id: 'entrepreneur'}) CREATE (m)-[:SUITS]->(c)

-- Create Career -> Skill relationships (REQUIRES)
MATCH (c:Career {id: 'software-engineer'}), (s:Skill {name: 'Python编程'}) CREATE (c)-[:REQUIRES]->(s)
MATCH (c:Career {id: 'software-engineer'}), (s:Skill {name: 'Java编程'}) CREATE (c)-[:REQUIRES]->(s)
MATCH (c:Career {id: 'software-engineer'}), (s:Skill {name: 'JavaScript'}) CREATE (c)-[:REQUIRES]->(s)

MATCH (c:Career {id: 'data-scientist'}), (s:Skill {name: 'Python编程'}) CREATE (c)-[:REQUIRES]->(s)
MATCH (c:Career {id: 'data-scientist'}), (s:Skill {name: '数据分析'}) CREATE (c)-[:REQUIRES]->(s)
MATCH (c:Career {id: 'data-scientist'}), (s:Skill {name: '机器学习'}) CREATE (c)-[:REQUIRES]->(s)

MATCH (c:Career {id: 'product-manager'}), (s:Skill {name: '项目管理'}) CREATE (c)-[:REQUIRES]->(s)
MATCH (c:Career {id: 'product-manager'}), (s:Skill {name: '沟通能力'}) CREATE (c)-[:REQUIRES]->(s)
MATCH (c:Career {id: 'product-manager'}), (s:Skill {name: '领导力'}) CREATE (c)-[:REQUIRES]->(s)

MATCH (c:Career {id: 'ux-designer'}), (s:Skill {name: '用户研究'}) CREATE (c)-[:REQUIRES]->(s)
MATCH (c:Career {id: 'ux-designer'}), (s:Skill {name: '创造力'}) CREATE (c)-[:REQUIRES]->(s)

-- Create LearningPath -> Career relationships (TARGETS)
MATCH (lp:LearningPath {id: 'software-engineer-path'}), (c:Career {id: 'software-engineer'}) CREATE (lp)-[:TARGETS]->(c)
MATCH (lp:LearningPath {id: 'data-scientist-path'}), (c:Career {id: 'data-scientist'}) CREATE (lp)-[:TARGETS]->(c)
MATCH (lp:LearningPath {id: 'product-manager-path'}), (c:Career {id: 'product-manager'}) CREATE (lp)-[:TARGETS]->(c)

-- Create LearningPath -> Course relationships (INCLUDES)
MATCH (lp:LearningPath {id: 'software-engineer-path'}), (course:Course {id: 'python-basics'}) CREATE (lp)-[:INCLUDES]->(course)
MATCH (lp:LearningPath {id: 'data-scientist-path'}), (course:Course {id: 'python-basics'}) CREATE (lp)-[:INCLUDES]->(course)
MATCH (lp:LearningPath {id: 'data-scientist-path'}), (course:Course {id: 'data-science-intro'}) CREATE (lp)-[:INCLUDES]->(course)
MATCH (lp:LearningPath {id: 'product-manager-path'}), (course:Course {id: 'product-management'}) CREATE (lp)-[:INCLUDES]->(course)

-- Create Course -> Skill relationships (TEACHES)
MATCH (course:Course {id: 'python-basics'}), (s:Skill {name: 'Python编程'}) CREATE (course)-[:TEACHES]->(s)
MATCH (course:Course {id: 'data-science-intro'}), (s:Skill {name: '数据分析'}) CREATE (course)-[:TEACHES]->(s)
MATCH (course:Course {id: 'data-science-intro'}), (s:Skill {name: '机器学习'}) CREATE (course)-[:TEACHES]->(s)
MATCH (course:Course {id: 'product-management'}), (s:Skill {name: '项目管理'}) CREATE (course)-[:TEACHES]->(s)
MATCH (course:Course {id: 'ux-design-fundamentals'}), (s:Skill {name: '用户研究'}) CREATE (course)-[:TEACHES]->(s)
