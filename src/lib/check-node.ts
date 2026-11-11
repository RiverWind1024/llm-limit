const major = Number(process.versions.node.split(".")[0]);

if (!Number.isFinite(major) || major < 20) {
  console.error(`llm-quota 需要 Node.js 20+，当前是 ${process.versions.node}。`);
  console.error("请升级 Node 后重试。");
  process.exit(1);
}
