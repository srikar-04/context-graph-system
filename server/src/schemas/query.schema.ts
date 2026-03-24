import { z } from "zod";

export const chatRequestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});
