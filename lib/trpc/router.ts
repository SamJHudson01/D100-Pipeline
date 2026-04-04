import { router } from "./init";
import { companyRouter } from "./routers/company";
import { triageRouter } from "./routers/triage";
import { dream100Router } from "./routers/dream100";
import { touchpointRouter } from "./routers/touchpoint";
import { settingsRouter } from "./routers/settings";
import { researchRouter } from "./routers/research";

export const appRouter = router({
  company: companyRouter,
  triage: triageRouter,
  dream100: dream100Router,
  touchpoint: touchpointRouter,
  settings: settingsRouter,
  research: researchRouter,
});

export type AppRouter = typeof appRouter;
