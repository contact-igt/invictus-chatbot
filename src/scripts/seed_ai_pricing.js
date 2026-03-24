import db from "../database/index.js";

const AI_MODELS = [
  {
    model: "gpt-4o",
    description: "Most capable model for complex output generation",
    recommended_for: "output",
    category: "premium",
    input_rate: 2.5,
    output_rate: 10.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4o-mini",
    description: "Fast and affordable for input classification tasks",
    recommended_for: "input",
    category: "budget",
    input_rate: 0.15,
    output_rate: 0.6,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.1",
    description:
      "Latest flagship model with improved coding and instruction following",
    recommended_for: "both",
    category: "premium",
    input_rate: 2.0,
    output_rate: 8.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.1-mini",
    description: "Balanced performance and cost for general tasks",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 0.4,
    output_rate: 1.6,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.1-nano",
    description:
      "Ultra-low-cost model for simple classification and extraction",
    recommended_for: "input",
    category: "budget",
    input_rate: 0.1,
    output_rate: 0.4,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o4-mini",
    description: "Reasoning model for complex decision making",
    recommended_for: "both",
    category: "reasoning",
    input_rate: 1.1,
    output_rate: 4.4,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o3-mini",
    description: "Cost-efficient reasoning model",
    recommended_for: "both",
    category: "reasoning",
    input_rate: 1.1,
    output_rate: 4.4,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o1",
    description: "OpenAI flagship reasoning model for complex multi-step tasks",
    recommended_for: "output",
    category: "reasoning",
    input_rate: 15.0,
    output_rate: 60.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o1-mini",
    description: "Fast, affordable reasoning model for STEM and coding tasks",
    recommended_for: "both",
    category: "reasoning",
    input_rate: 1.1,
    output_rate: 4.4,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o3",
    description:
      "Advanced reasoning model with superior problem-solving ability",
    recommended_for: "output",
    category: "reasoning",
    input_rate: 10.0,
    output_rate: 40.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.5",
    description:
      "Most capable GPT model with enhanced creativity and nuanced understanding",
    recommended_for: "output",
    category: "premium",
    input_rate: 75.0,
    output_rate: 150.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o3-pro",
    description:
      "Professional-grade reasoning model for the most demanding tasks",
    recommended_for: "output",
    category: "reasoning",
    input_rate: 20.0,
    output_rate: 80.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4o-audio-preview",
    description: "GPT-4o with audio input/output capabilities",
    recommended_for: "both",
    category: "premium",
    input_rate: 2.5,
    output_rate: 10.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-5",
    description:
      "Most powerful OpenAI model with breakthrough reasoning and multimodal capabilities",
    recommended_for: "output",
    category: "premium",
    input_rate: 100.0,
    output_rate: 300.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-5-mini",
    description:
      "Affordable GPT-5 variant balancing next-gen capability with cost",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 8.0,
    output_rate: 24.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.5-mini",
    description:
      "Affordable variant of GPT-4.5 for mid-range tasks with strong capability",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 7.5,
    output_rate: 15.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.5-nano",
    description:
      "Ultra-lightweight GPT-4.5 variant for high-volume, low-cost tasks",
    recommended_for: "input",
    category: "budget",
    input_rate: 1.5,
    output_rate: 3.0,
    markup_percent: 0,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
];

async function run() {
  try {
    // Sync table schema (adds new columns if needed)
    await db.AiPricing.sync({ alter: true });

    for (const modelData of AI_MODELS) {
      const [record, created] = await db.AiPricing.findOrCreate({
        where: { model: modelData.model },
        defaults: modelData,
      });

      if (created) {
        console.log(
          `✅ Created: ${modelData.model} (${modelData.category}, ${modelData.recommended_for})`,
        );
      } else {
        // Update description, recommended_for, category for existing records
        await record.update({
          description: modelData.description,
          recommended_for: modelData.recommended_for,
          category: modelData.category,
        });
        console.log(`🔄 Updated metadata: ${modelData.model}`);
      }
    }

    console.log("\n✅ AI pricing seed complete. All 17 models configured.");
  } catch (err) {
    console.error("❌ Error setting up AI pricing table:", err.message);
  }
  process.exit(0);
}

run();
