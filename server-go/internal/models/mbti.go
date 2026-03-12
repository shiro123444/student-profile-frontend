package models

// MBTI related models for Neo4j integration

// MBTIAnswer represents a single MBTI test answer
type MBTIAnswer struct {
	QuestionID int    `json:"questionId" binding:"required"`
	Answer     string `json:"answer" binding:"required,oneof=A B"`
}

// MBTISubmitData represents the data submitted for MBTI test
type MBTISubmitData struct {
	StudentName string       `json:"studentName" binding:"required"`
	Answers     []MBTIAnswer `json:"answers" binding:"required,min=1"`
}

// MBTIResult represents the result of MBTI test
type MBTIResult struct {
	StudentID  string             `json:"studentId"`
	MBTICode   string             `json:"mbtiCode"`
	Dimensions MBTIDimensions     `json:"dimensions"`
}

// MBTIDimensions represents the scores for each MBTI dimension
type MBTIDimensions struct {
	E int `json:"E"`
	I int `json:"I"`
	S int `json:"S"`
	N int `json:"N"`
	T int `json:"T"`
	F int `json:"F"`
	J int `json:"J"`
	P int `json:"P"`
}

// MBTIType represents an MBTI personality type
type MBTIType struct {
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Strengths   []string `json:"strengths"`
	Weaknesses  []string `json:"weaknesses"`
	Careers     []string `json:"careers"`
}

// Career represents a career option
type Career struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Skills      []string `json:"skills"`
	Salary      string   `json:"salary,omitempty"`
	Growth      string   `json:"growth,omitempty"`
}

// Course represents a learning course
type Course struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Provider   string   `json:"provider"`
	Duration   string   `json:"duration"`
	Difficulty string   `json:"difficulty"`
	Skills     []string `json:"skills"`
	Rating     float64  `json:"rating"`
	URL        string   `json:"url,omitempty"`
}

// LearningPath represents a structured learning path
type LearningPath struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	TargetCareer      string   `json:"targetCareer"`
	EstimatedDuration string   `json:"estimatedDuration"`
	Courses           []Course `json:"courses"`
}

// GraphNode represents a node in the knowledge graph
type GraphNode struct {
	ID         string                 `json:"id"`
	Label      string                 `json:"label"`
	Properties map[string]interface{} `json:"properties"`
}

// GraphEdge represents an edge in the knowledge graph
type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

// GraphData represents the complete graph structure
type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}
