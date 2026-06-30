import { i as createServerFn } from "./esm-Dova13aH.js";
import { t as createServerRpc } from "./createServerRpc-WJgk8O8C.js";
//#region src/lib/vision.ts?tss-serverfn-split
var analyzeCarImage_createServerFn_handler = createServerRpc({
	id: "9f0b7d8c14dbe0b4b239e41c0f124d57127f5e2ebc7d6c7ae8afb695afae8967",
	name: "analyzeCarImage",
	filename: "src/lib/vision.ts"
}, (opts) => analyzeCarImage.__executeServer(opts));
var analyzeCarImage = createServerFn({ method: "POST" }).validator((data) => data).handler(analyzeCarImage_createServerFn_handler, async ({ data: { imageBase64, angle, label } }) => {
	const apiKey = process.env.VITE_OPENAI_API_KEY || "";
	if (!apiKey) {
		console.warn("VITE_OPENAI_API_KEY is not set. Returning mock analysis.");
		return mockAnalysis();
	}
	try {
		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [{
					role: "system",
					content: `You are a vehicle damage inspector for a ride-hailing company (like Uber). 
Analyze the car photo and detect any dents, scratches, cracks, rust, or physical damage on the vehicle.

Respond ONLY with valid JSON in this exact format, no markdown or backticks:
{
  "hasDamage": true/false,
  "description": "short summary of condition",
  "severity": "none"/"minor"/"moderate"/"severe",
  "details": ["specific observation 1", "specific observation 2"]
}

If the car is clean and in good condition: hasDamage=false, severity="none", details=["No damage detected. Vehicle looks clean and well-maintained."]

Be thorough but realistic. Small stone chips or normal wear-and-tear on the road should be noted but severity should be "minor". Dents larger than a coin should be "moderate". Anything structural or large should be "severe".`
				}, {
					role: "user",
					content: [{
						type: "text",
						text: `Analyze this ${label} (${angle} angle) photo of the car for any dents, scratches, or damage. Return only JSON.`
					}, {
						type: "image_url",
						image_url: {
							url: imageBase64,
							detail: "high"
						}
					}]
				}],
				max_tokens: 300,
				temperature: .1
			})
		});
		if (!response.ok) {
			const errText = await response.text();
			console.error("OpenAI API error:", response.status, errText);
			return mockAnalysis();
		}
		const content = (await response.json()).choices?.[0]?.message?.content || "";
		try {
			return JSON.parse(content.trim());
		} catch {
			const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
			try {
				return JSON.parse(cleaned);
			} catch {
				console.error("Failed to parse OpenAI response:", content);
				return {
					hasDamage: false,
					description: "Unable to analyze",
					severity: "none",
					details: ["AI analysis could not be parsed."]
				};
			}
		}
	} catch (err) {
		console.error("OpenAI Vision error:", err?.message || err);
		return mockAnalysis();
	}
});
function mockAnalysis() {
	const outcomes = [
		{
			hasDamage: false,
			description: "Vehicle appears clean with no visible damage",
			severity: "none",
			details: [
				"No dents detected on the body panels",
				"No scratches or paint damage visible",
				"Vehicle looks well-maintained"
			]
		},
		{
			hasDamage: true,
			description: "Minor scratch detected on the bodywork",
			severity: "minor",
			details: [
				"Small scratch visible on the panel surface",
				"No structural damage observed",
				"Scratch appears superficial — likely from road debris"
			]
		},
		{
			hasDamage: false,
			description: "Clean exterior with no signs of damage",
			severity: "none",
			details: [
				"All body panels appear intact",
				"No rust or corrosion visible",
				"Vehicle is in good external condition"
			]
		},
		{
			hasDamage: true,
			description: "Small dent observed on the body panel",
			severity: "moderate",
			details: [
				"Dent approximately 3-5cm in diameter visible",
				"Paint is intact — no cracking or peeling at site",
				"Likely caused by a minor parking impact"
			]
		}
	];
	return outcomes[Math.floor(Math.random() * outcomes.length)];
}
//#endregion
export { analyzeCarImage_createServerFn_handler };
