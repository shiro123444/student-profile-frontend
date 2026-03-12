package main

import (
	"context"
	"fmt"
	"log"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

type MBTITypeSeed struct {
	Code        string
	Name        string
	Description string
	Strengths   []string
	Weaknesses  []string
}

func main() {
	ctx := context.Background()

	driver, err := neo4j.NewDriverWithContext(
		"bolt://localhost:7687",
		neo4j.BasicAuth("neo4j", "password123", ""),
	)
	if err != nil {
		log.Fatalf("Failed to create driver: %v", err)
	}
	defer driver.Close(ctx)

	err = driver.VerifyConnectivity(ctx)
	if err != nil {
		log.Fatalf("Failed to verify connectivity: %v", err)
	}
	log.Println("Connected to Neo4j")

	// Delete existing MBTI types
	session := driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	_, err = session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		_, err := tx.Run(ctx, "MATCH (m:MBTIType) DETACH DELETE m", nil)
		return nil, err
	})
	if err != nil {
		log.Fatalf("Failed to delete existing MBTI types: %v", err)
	}
	session.Close(ctx)
	log.Println("Deleted existing MBTI types")

	mbtiTypes := []MBTITypeSeed{
		{
			Code:        "INTJ",
			Name:        "建筑师",
			Description: "富有想象力和战略性的思考者，一切皆在计划之中。独立、果断，有着高标准和强烈的内在驱动力。善于制定长远计划并坚持执行。",
			Strengths:   []string{"战略性思维，善于规划", "独立自主，意志坚定", "追求知识和能力", "高标准严要求"},
			Weaknesses:  []string{"可能过于追求完美而忽视他人感受", "社交场合可能显得冷淡", "容易过度分析", "对不符合标准的事物缺乏耐心"},
		},
		{
			Code:        "INTP",
			Name:        "逻辑学家",
			Description: "具有创新精神的发明家，对知识有着不可抑制的渴望。喜欢分析和理解复杂的理论概念，追求逻辑上的精确和清晰。",
			Strengths:   []string{"逻辑分析能力强", "创新思维活跃", "客观理性", "学习能力出众"},
			Weaknesses:  []string{"可能忽视实际操作细节", "社交互动可能有困难", "容易陷入理论而忽略实践", "决策时可能过于犹豫"},
		},
		{
			Code:        "ENTJ",
			Name:        "指挥官",
			Description: "大胆、富有想象力且意志坚强的领导者，总能找到或创造解决方案。天生的领导者，善于组织和推动团队达成目标。",
			Strengths:   []string{"卓越的领导能力", "战略规划能力强", "果断高效", "善于激励他人"},
			Weaknesses:  []string{"可能过于强势和控制", "对低效率缺乏耐心", "可能忽视他人情感", "工作狂倾向"},
		},
		{
			Code:        "ENTP",
			Name:        "辩论家",
			Description: "聪明好奇的思考者，不会放过任何智力上的挑战。喜欢辩论和探索新想法，善于从多角度看待问题。",
			Strengths:   []string{"创新能力强", "思维敏捷灵活", "善于辩论和说服", "适应力强"},
			Weaknesses:  []string{"可能缺乏持续的执行力", "容易对常规工作感到厌倦", "争论性强可能影响关系", "可能忽视细节"},
		},
		{
			Code:        "INFJ",
			Name:        "提倡者",
			Description: "安静而神秘，同时也是鼓舞人心的理想主义者。有着深刻的洞察力和同理心，致力于实现自己的远大理想。",
			Strengths:   []string{"深刻的洞察力", "强烈的同理心", "理想主义驱动", "善于启发他人"},
			Weaknesses:  []string{"可能过于理想化", "容易因他人的问题而疲惫", "较为敏感", "决策时可能过于关注感受"},
		},
		{
			Code:        "INFP",
			Name:        "调停者",
			Description: "诗意、善良的利他主义者，总是热心为正义事业提供帮助。内心世界丰富，追求真实和有意义的生活。",
			Strengths:   []string{"创造力丰富", "同理心强", "追求价值和意义", "适应能力好"},
			Weaknesses:  []string{"可能过于理想主义", "容易自我批评", "实际操作能力可能不足", "容易受到他人情绪影响"},
		},
		{
			Code:        "ENFJ",
			Name:        "主人公",
			Description: "富有魅力和鼓舞力的领导者，能够吸引听众。天生的导师和领袖，善于理解他人需求并引导团队发展。",
			Strengths:   []string{"优秀的人际沟通能力", "善于激励和引导他人", "有远见和责任感", "组织协调能力强"},
			Weaknesses:  []string{"可能过于关注他人而忽视自己", "容易对批评过于敏感", "有时过于理想化", "可能难以做出不受欢迎的决定"},
		},
		{
			Code:        "ENFP",
			Name:        "竞选者",
			Description: "热情、有创造力、社交能力强的自由精神，总能找到理由微笑。充满热情和想象力，善于发现生活中的可能性。",
			Strengths:   []string{"热情洋溢有感染力", "创造力和想象力丰富", "善于沟通和人际交往", "适应力和灵活性强"},
			Weaknesses:  []string{"可能缺乏专注力", "容易分心于新项目", "可能逃避冲突", "有时过于乐观而忽视现实"},
		},
		{
			Code:        "ISTJ",
			Name:        "物流师",
			Description: "务实且注重事实的个人，其可靠性不容置疑。负责任、有条理，重视传统和忠诚，是值得信赖的执行者。",
			Strengths:   []string{"可靠负责", "条理性强", "注重细节和事实", "坚持不懈"},
			Weaknesses:  []string{"可能过于死板", "不擅长适应变化", "可能忽视他人感受", "对新方法持保守态度"},
		},
		{
			Code:        "ISFJ",
			Name:        "守卫者",
			Description: "非常专注和温暖的守护者，随时准备保护所爱之人。忠诚、体贴，默默付出，是团队中不可或缺的支持力量。",
			Strengths:   []string{"忠诚可靠", "观察力敏锐", "耐心细致", "善于支持和照顾他人"},
			Weaknesses:  []string{"可能过于谦虚不善自我推销", "容易承担过多责任", "对变化适应较慢", "可能压抑自己的需求"},
		},
		{
			Code:        "ESTJ",
			Name:        "总经理",
			Description: "出色的管理者，在管理事物和人方面无与伦比。务实果断，善于建立秩序和组织结构，是天生的执行者。",
			Strengths:   []string{"组织管理能力强", "果断高效", "负责守信", "逻辑思维清晰"},
			Weaknesses:  []string{"可能过于固执己见", "不够灵活变通", "可能忽视他人情感", "对不遵守规则者缺乏耐心"},
		},
		{
			Code:        "ESFJ",
			Name:        "执政官",
			Description: "非常关心他人的人，善于社交且受欢迎，总是热心助人。温暖友善，注重和谐的人际关系，是出色的团队协作者。",
			Strengths:   []string{"善于关心和照顾他人", "社交能力强", "负责有组织性", "善于维护和谐关系"},
			Weaknesses:  []string{"可能过于在意他人评价", "害怕冲突和拒绝", "可能过度奉献", "较难接受批评"},
		},
		{
			Code:        "ISTP",
			Name:        "鉴赏家",
			Description: "大胆且实际的实验者，善于使用各种工具。冷静理性，善于分析和解决实际问题，喜欢动手操作和探索。",
			Strengths:   []string{"动手能力强", "善于分析问题", "冷静理性", "适应力强"},
			Weaknesses:  []string{"可能过于冷漠", "不善于表达情感", "容易感到无聊", "可能冒不必要的风险"},
		},
		{
			Code:        "ISFP",
			Name:        "探险家",
			Description: "灵活、有魅力的艺术家，随时准备探索和体验新事物。温和敏感，重视个人价值观，喜欢用行动表达自己。",
			Strengths:   []string{"艺术感和审美能力强", "温和体贴", "适应力强", "注重当下体验"},
			Weaknesses:  []string{"可能过于敏感", "不善于长期规划", "容易逃避冲突", "可能缺乏自信"},
		},
		{
			Code:        "ESTP",
			Name:        "企业家",
			Description: "聪明、精力充沛且善于感知的人，真正享受生活在边缘。充满活力，善于把握机会，喜欢冒险和挑战。",
			Strengths:   []string{"行动力强", "善于把握机会", "适应力和社交能力强", "务实解决问题"},
			Weaknesses:  []string{"可能过于冲动", "不善于长期规划", "容易感到无聊", "可能忽视他人感受"},
		},
		{
			Code:        "ESFP",
			Name:        "表演者",
			Description: "自发的、精力充沛的表演者，生活在他们周围永远不会无聊。热爱生活，善于娱乐和感染他人，是天生的表演者。",
			Strengths:   []string{"热情开朗有感染力", "善于人际交往", "适应力和灵活性强", "注重享受当下"},
			Weaknesses:  []string{"可能缺乏长远规划", "容易分心", "可能逃避严肃话题", "对批评较为敏感"},
		},
	}

	// Seed each MBTI type
	for _, mt := range mbtiTypes {
		session := driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
		_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
			query := `
				CREATE (m:MBTIType {
					code: $code,
					name: $name,
					description: $description,
					strengths: $strengths,
					weaknesses: $weaknesses
				})
				RETURN m.code as code, m.name as name
			`
			params := map[string]interface{}{
				"code":        mt.Code,
				"name":        mt.Name,
				"description": mt.Description,
				"strengths":   mt.Strengths,
				"weaknesses":  mt.Weaknesses,
			}

			result, err := tx.Run(ctx, query, params)
			if err != nil {
				return nil, err
			}

			if result.Next(ctx) {
				record := result.Record()
				code, _ := record.Get("code")
				name, _ := record.Get("name")
				fmt.Printf("  Created: %s - %s\n", code, name)
			}

			return nil, nil
		})
		session.Close(ctx)

		if err != nil {
			log.Fatalf("Failed to seed %s: %v", mt.Code, err)
		}
	}

	log.Printf("Successfully seeded %d MBTI types", len(mbtiTypes))

	// Verify by reading back
	session = driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (interface{}, error) {
		res, err := tx.Run(ctx, "MATCH (m:MBTIType) RETURN m.code as code, m.name as name ORDER BY m.code", nil)
		if err != nil {
			return nil, err
		}

		fmt.Println("\nVerification - reading back:")
		count := 0
		for res.Next(ctx) {
			record := res.Record()
			code, _ := record.Get("code")
			name, _ := record.Get("name")
			fmt.Printf("  %s: %s\n", code, name)
			count++
		}
		return count, nil
	})
	session.Close(ctx)

	if err != nil {
		log.Fatalf("Verification failed: %v", err)
	}
	fmt.Printf("\nTotal verified: %d types\n", result.(int))
}
