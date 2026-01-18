import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import rag from "@convex-dev/rag/convex.config";
import entities from "./entities/convex.config";

const app = defineApp();
app.use(agent);
app.use(rag);
app.use(entities);

export default app;