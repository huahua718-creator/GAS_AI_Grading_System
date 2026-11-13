import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ASSESSMENT_SCHEMA = {
  type: "object",
  properties: {
    totalScore: { type: "number", description: "綜合評核總分 (滿分 100)" },
    rubricScores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string", description: "評分規準指標名稱" },
          score: { type: "number", description: "該項實得分數" },
          maxScore: { type: "number", description: "該項滿分" },
          comment: { type: "string", description: "針對該項目的具體講評細節" },
        },
        required: ["criterion", "score", "maxScore", "comment"],
      },
    },
    overallFeedback: {
      type: "string",
      description: "全篇作業的整體核心講評（150字內，包含亮點與肯定處）",
    },
    improvements: {
      type: "array",
      items: { type: "string" },
      description: "具體待改進項目清單",
    },
    rewriteExample: {
      type: "string",
      description: "針對作業中最需改進的段落或解題步驟，提供示範性的專業重寫範例",
    },
  },
  required: ["totalScore", "rubricScores", "overallFeedback", "improvements", "rewriteExample"],
};

export async function POST(req: Request) {
  try {
    // Strict BYOK: Header > Body > Env
    const authHeader = req.headers.get("x-gemini-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    const body = await req.json();
    const apiKey = authHeader || body.apiKey || process.env.GEMINI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
      return NextResponse.json(
        { error: "未提供 Gemini API Key。請填入您在 Google AI Studio 申請的金鑰 (BYOK)" },
        { status: 401 }
      );
    }

    const { docText, imageBase64, imageMimeType = "image/jpeg", rubricConfig, studentName } = body;

    if (!docText && !imageBase64) {
      return NextResponse.json({ error: "作業內容為空 (需提供 docText 或 imageBase64)" }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

    const rubricDescription = JSON.stringify(rubricConfig || [], null, 2);
    const systemPrompt =
      "你是一位專業的高中與大學資深教師，請根據以下提供的評分規準 (Rubrics)，客觀嚴謹地批改學生作業。\n" +
      "【評分規準清單 (Rubric)】:\n" +
      rubricDescription +
      "\n\n請務必依循規準嚴格評定各項得分，總分滿分對齊100分，並給予具體回饋與一段優美的示範重寫。";

    const inputParts: any[] = [{ type: "text", text: systemPrompt }];

    if (imageBase64) {
      inputParts.push({
        type: "text",
        text: `【學生 ${studentName || ""} 作業原始手寫/照片檔案】：\n請透過視覺 OCR 辨識題號、算式、解題步驟、文字與答案，檢查推導是否合理、觀念是否正確，並依據規準評分。`,
      });
      inputParts.push({
        type: "image",
        data: imageBase64,
        mime_type: imageMimeType,
      });
    } else {
      inputParts.push({
        type: "text",
        text: `【學生 ${studentName || ""} 作業全文內容】：\n${(docText || "").substring(0, 15000)}`,
      });
    }

    const interaction = await ai.interactions.create({
      model: "gemini-3.8-flash",
      input: inputParts,
      response_format: ASSESSMENT_SCHEMA,
    });

    const rawOutput = interaction.output_text;
    if (!rawOutput) {
      throw new Error("Gemini API 未回傳有效評分結果");
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(rawOutput);
    } catch {
      const cleaned = rawOutput.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedResult = JSON.parse(cleaned);
    }

    return NextResponse.json({
      success: true,
      assessment: parsedResult,
    });
  } catch (err: any) {
    console.error("Assessment error:", err);
    return NextResponse.json(
      { error: err.message || "AI 批改作業失敗" },
      { status: 500 }
    );
  }
}

