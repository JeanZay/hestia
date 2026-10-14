import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/qualification/comment-voice/rollback/migration.test.ts"],environment:"node",maxWorkers:1,fileParallelism:false,testTimeout:60000}});
