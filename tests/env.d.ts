import { Scheduler } from "../src/index";

type Env = {
  SCHEDULER: DurableObjectNamespace<Scheduler<Env>>;
};

declare module "cloudflare:test" {
  // Controls the type of `import("cloudflare:test").env`
  interface ProvidedEnv extends Env {}
}
