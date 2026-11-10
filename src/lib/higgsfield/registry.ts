import { z } from "zod";
import raw from "./models.json";

// 모델 레지스트리는 데이터다. models.json에 항목을 추가하면 코드 수정 없이 모델이 늘어난다.

const rgb = z.object({ rgb: z.array(z.number().int().min(0).max(255)).length(3) }).strict();

const fieldSpec = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), required: z.boolean().optional(), min: z.number().int().optional(), max: z.number().int().optional() }).strict(),
  z.object({ type: z.literal("enum"), required: z.boolean().optional(), values: z.array(z.string()).min(1), default: z.string().optional() }).strict(),
  z.object({ type: z.literal("integer"), required: z.boolean().optional(), min: z.number().int().optional(), max: z.number().int().optional(), values: z.array(z.number().int()).optional(), default: z.number().int().optional() }).strict(),
  z.object({ type: z.literal("number"), required: z.boolean().optional(), min: z.number().optional(), max: z.number().optional(), default: z.number().optional() }).strict(),
  z.object({ type: z.literal("boolean"), required: z.boolean().optional(), default: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("url"), required: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("url_array"), required: z.boolean().optional(), max: z.number().int().optional() }).strict(),
  z.object({ type: z.literal("rgb"), required: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("rgb_array"), required: z.boolean().optional(), exact: z.number().int().optional() }).strict(),
]);
export type FieldSpec = z.infer<typeof fieldSpec>;

const modelSpec = z
  .object({
    key: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    kind: z.enum(["image", "video"]),
    endpoint: z.string().regex(/^\/[A-Za-z0-9._\/-]+$/),
    docUrl: z.string().startsWith("https://docs.higgsfield.ai/"),
    useCases: z.array(z.string()).min(1),
    fields: z.record(z.string(), fieldSpec),
  })
  .strict();
export type ModelSpec = z.infer<typeof modelSpec>;

const registrySpec = z.object({ _note: z.string().optional(), models: z.array(modelSpec).min(1) }).strict();

export function parseRegistry(data: unknown): ModelSpec[] {
  const { models } = registrySpec.parse(data);
  const seen = new Set<string>();
  for (const m of models) {
    if (seen.has(m.key)) throw new Error(`모델 키가 중복됩니다: ${m.key}`);
    seen.add(m.key);
    for (const [name, f] of Object.entries(m.fields)) {
      if (f.type === "enum" && f.default !== undefined && !f.values.includes(f.default))
        throw new Error(`${m.key}.${name}: 기본값이 허용 값에 없습니다`);
    }
  }
  return models;
}

export const MODELS: ModelSpec[] = parseRegistry(raw);

export function getModel(key: string): ModelSpec {
  const m = MODELS.find((x) => x.key === key);
  if (!m) throw new Error(`레지스트리에 없는 모델입니다: ${key}`);
  return m;
}

const httpUrl = z.string().regex(/^https?:\/\//).max(8192);

function fieldToZod(f: FieldSpec): z.ZodTypeAny {
  switch (f.type) {
    case "string": {
      let s = z.string();
      if (f.min !== undefined) s = s.min(f.min);
      if (f.max !== undefined) s = s.max(f.max);
      return s;
    }
    case "enum":
      return z.enum(f.values as [string, ...string[]]);
    case "integer": {
      if (f.values) return z.number().int().refine((v) => f.values!.includes(v), { message: `허용 값: ${f.values.join(", ")}` });
      let n = z.number().int();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      return n;
    }
    case "number": {
      let n = z.number();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      return n;
    }
    case "boolean":
      return z.boolean();
    case "url":
      return httpUrl;
    case "url_array": {
      let a = z.array(httpUrl);
      if (f.max !== undefined) a = a.max(f.max);
      return a;
    }
    case "rgb":
      return rgb;
    case "rgb_array": {
      const a = z.array(rgb);
      return f.exact !== undefined ? a.length(f.exact) : a;
    }
  }
}

/** 모델 스키마에 없는 필드와 허용되지 않는 값을 거부한다. 기본값은 채우지 않고 Higgsfield에 맡긴다. */
export function validateInput(modelKey: string, input: unknown): Record<string, unknown> {
  const model = getModel(modelKey);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, f] of Object.entries(model.fields)) {
    const zf = fieldToZod(f);
    shape[name] = f.required ? zf : zf.optional();
  }
  return z.object(shape).strict().parse(input) as Record<string, unknown>;
}
