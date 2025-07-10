/*
 * @Author: 周克朋 15538308935@163.com
 * @Date: 2025-07-10 16:39:21
 * @LastEditors: 周克朋 15538308935@163.com
 * @LastEditTime: 2025-07-10 16:42:07
 * @FilePath: \usbManger\usb-file-monitor\src\util\index.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// 修改控制台输出处理函数
function formatloggerMessage(message, type = "log") {
    const iconv = require("iconv-lite");

    try {
        let formattedMessage = "";
        const timestamp = new Date().toLocaleTimeString();
        const prefix = type === "error" ? "错误" : "信息";

        // 处理不同类型的消息
        if (Buffer.isBuffer(message)) {
            formattedMessage = iconv.decode(message, "gbk");
        } else if (typeof message === "object" && message !== null) {
            if (message instanceof Error) {
                formattedMessage = message.message || message.toString();
            } else {
                formattedMessage = JSON.stringify(message, null, 2);
            }
        } else if (typeof message === "string") {
            formattedMessage = message;
        }

        // 使用 GBK 编码输出
        const outputMessage = `[${timestamp}] [${prefix}] ${formattedMessage}\n`;
        const outputBuffer = iconv.encode(outputMessage, "gbk");

        if (type === "error") {
            process.stderr.write(outputBuffer);
        } else {
            process.stdout.write(outputBuffer);
        }
    } catch (err) {
        process.stderr.write(
            iconv.encode(`日志格式化失败: ${err.toString()}\n`, "gbk")
        );
    }
}
// 创建自定义日志函数
const logger = {
    log: (message) => formatloggerMessage(message, "log"),
    error: (message) => formatloggerMessage(message, "error"),
    info: (message) => formatloggerMessage(message, "log"),
    warn: (message) => formatloggerMessage(message, "error")
};
module.exports = { logger };