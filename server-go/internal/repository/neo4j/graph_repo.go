package neo4j

import (
	"context"
	"fmt"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"pathmind-server/internal/models"
	"go.uber.org/zap"
)

type GraphRepository struct {
	driver neo4j.DriverWithContext
	logger *zap.Logger
}

func NewGraphRepository(driver neo4j.DriverWithContext, logger *zap.Logger) *GraphRepository {
	return &GraphRepository{
		driver: driver,
		logger: logger,
	}
}

// GetFullGraph retrieves the complete knowledge graph
func (r *GraphRepository) GetFullGraph(ctx context.Context) (*models.GraphData, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		// Get all nodes
		nodesQuery := `
			MATCH (n)
			WHERE n:MBTIType OR n:Career OR n:Skill OR n:Course OR n:LearningPath
			RETURN id(n) as id, labels(n)[0] as label, properties(n) as properties
			LIMIT 500
		`

		nodesResult, err := tx.Run(ctx, nodesQuery, nil)
		if err != nil {
			return nil, err
		}

		var nodes []models.GraphNode
		for nodesResult.Next(ctx) {
			record := nodesResult.Record()

			idVal, _ := record.Get("id")
			labelVal, _ := record.Get("label")
			propsVal, _ := record.Get("properties")

			node := models.GraphNode{
				ID:         fmt.Sprint(idVal),
				Label:      fmt.Sprint(labelVal),
				Properties: propsVal.(map[string]interface{}),
			}
			nodes = append(nodes, node)
		}

		// Get all relationships
		edgesQuery := `
			MATCH (a)-[r]->(b)
			WHERE (a:MBTIType OR a:Career OR a:Skill OR a:Course OR a:LearningPath)
			  AND (b:MBTIType OR b:Career OR b:Skill OR b:Course OR b:LearningPath)
			RETURN id(a) as source, id(b) as target, type(r) as type
			LIMIT 1000
		`

		edgesResult, err := tx.Run(ctx, edgesQuery, nil)
		if err != nil {
			return nil, err
		}

		var edges []models.GraphEdge
		for edgesResult.Next(ctx) {
			record := edgesResult.Record()

			sourceVal, _ := record.Get("source")
			targetVal, _ := record.Get("target")
			typeVal, _ := record.Get("type")

			edge := models.GraphEdge{
				Source: fmt.Sprint(sourceVal),
				Target: fmt.Sprint(targetVal),
				Type:   fmt.Sprint(typeVal),
			}
			edges = append(edges, edge)
		}

		return &models.GraphData{
			Nodes: nodes,
			Edges: edges,
		}, nil
	})

	if err != nil {
		r.logger.Error("Failed to get full graph", zap.Error(err))
		return nil, err
	}

	return result.(*models.GraphData), nil
}

// GetStudentGraph retrieves the knowledge graph for a specific student
func (r *GraphRepository) GetStudentGraph(ctx context.Context, studentID string) (*models.GraphData, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH path = (s:Student {name: $studentID})-[*1..3]-(n)
			WITH collect(distinct s) + collect(distinct n) as nodes,
			     [r in relationships(path) | r] as rels
			UNWIND nodes as node
			WITH collect(distinct {
			    id: toString(id(node)),
			    label: labels(node)[0],
			    properties: properties(node)
			}) as nodeList, rels
			UNWIND rels as rel
			RETURN nodeList as nodes,
			       collect(distinct {
			           source: toString(id(startNode(rel))),
			           target: toString(id(endNode(rel))),
			           type: type(rel)
			       }) as edges
		`

		params := map[string]interface{}{"studentID": studentID}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			record := result.Record()

			nodesVal, _ := record.Get("nodes")
			edgesVal, _ := record.Get("edges")

			nodes := r.parseNodes(nodesVal)
			edges := r.parseEdges(edgesVal)

			return &models.GraphData{
				Nodes: nodes,
				Edges: edges,
			}, nil
		}

		return &models.GraphData{Nodes: []models.GraphNode{}, Edges: []models.GraphEdge{}}, nil
	})

	if err != nil {
		r.logger.Error("Failed to get student graph", zap.String("studentID", studentID), zap.Error(err))
		return nil, err
	}

	return result.(*models.GraphData), nil
}

// GetCareerGraph retrieves the knowledge graph for a specific career
func (r *GraphRepository) GetCareerGraph(ctx context.Context, careerID string) (*models.GraphData, error) {
	session := r.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		query := `
			MATCH path = (c:Career {id: $careerID})-[*1..2]-(n)
			WITH collect(distinct c) + collect(distinct n) as nodes,
			     [r in relationships(path) | r] as rels
			UNWIND nodes as node
			WITH collect(distinct {
			    id: toString(id(node)),
			    label: labels(node)[0],
			    properties: properties(node)
			}) as nodeList, rels
			UNWIND rels as rel
			RETURN nodeList as nodes,
			       collect(distinct {
			           source: toString(id(startNode(rel))),
			           target: toString(id(endNode(rel))),
			           type: type(rel)
			       }) as edges
		`

		params := map[string]interface{}{"careerID": careerID}

		result, err := tx.Run(ctx, query, params)
		if err != nil {
			return nil, err
		}

		if result.Next(ctx) {
			record := result.Record()

			nodesVal, _ := record.Get("nodes")
			edgesVal, _ := record.Get("edges")

			nodes := r.parseNodes(nodesVal)
			edges := r.parseEdges(edgesVal)

			return &models.GraphData{
				Nodes: nodes,
				Edges: edges,
			}, nil
		}

		return &models.GraphData{Nodes: []models.GraphNode{}, Edges: []models.GraphEdge{}}, nil
	})

	if err != nil {
		r.logger.Error("Failed to get career graph", zap.String("careerID", careerID), zap.Error(err))
		return nil, err
	}

	return result.(*models.GraphData), nil
}

// Helper functions
func (r *GraphRepository) parseNodes(val interface{}) []models.GraphNode {
	var nodes []models.GraphNode
	if nodeList, ok := val.([]interface{}); ok {
		for _, n := range nodeList {
			if nodeMap, ok := n.(map[string]interface{}); ok {
				node := models.GraphNode{
					ID:         getStringFromMap(nodeMap, "id"),
					Label:      getStringFromMap(nodeMap, "label"),
					Properties: getMapFromMap(nodeMap, "properties"),
				}
				nodes = append(nodes, node)
			}
		}
	}
	return nodes
}

func (r *GraphRepository) parseEdges(val interface{}) []models.GraphEdge {
	var edges []models.GraphEdge
	if edgeList, ok := val.([]interface{}); ok {
		for _, e := range edgeList {
			if edgeMap, ok := e.(map[string]interface{}); ok {
				edge := models.GraphEdge{
					Source: getStringFromMap(edgeMap, "source"),
					Target: getStringFromMap(edgeMap, "target"),
					Type:   getStringFromMap(edgeMap, "type"),
				}
				edges = append(edges, edge)
			}
		}
	}
	return edges
}

func getMapFromMap(m map[string]interface{}, key string) map[string]interface{} {
	if val, ok := m[key]; ok && val != nil {
		if mapVal, ok := val.(map[string]interface{}); ok {
			return mapVal
		}
	}
	return make(map[string]interface{})
}
