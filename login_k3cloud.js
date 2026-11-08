import { K3CloudWebAPI } from "./k3cloud.js";

// 启动登录验证的主函数
async function run() {
  // 初始化金蝶 K3Cloud WebAPI 客户端实例
  const client = new K3CloudWebAPI();
  console.log("Connecting to K3Cloud WebAPI...");
  
  // 执行登录操作（内部会自动探测内网/外网地址，并使用配置好的凭据登录）
  await client.login();
  // 提取登录成功的上下文数据 (Context)
  const context = client.context || {};
  
  console.log("WebAPI login succeeded.");
  // 输出登录相关环境配置信息，便于人工确认连接状态
  console.log(`Data center: ${context.DataCenterName || ""}`);                          // 数据中心名称
  console.log(`Organization: ${context.CurrentOrganizationInfo?.Name || ""}`);           // 当前登录的组织机构名称
  console.log(`User: ${context.UserName || ""}`);                                       // 登录用户名
  console.log(`Version: ${context.DisplayVersion || ""}`);                              // 金蝶系统当前大版本号
}

// 运行登录任务，捕获可能出现的连接或鉴权失败异常
run().catch(err => {
  console.error("Login failed:", err.message);
  process.exit(1); // 登录失败时退出进程，返回错误码 1
});
