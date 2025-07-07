/*
 * @Author: 周克朋 15538308935@163.com
 * @Date: 2025-02-27 17:31:13
 * @LastEditors: 周克朋 15538308935@163.com
 * @LastEditTime: 2025-07-07 15:08:39
 * @FilePath: \usb-file-monitor\src\login.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
const { ipcRenderer } = require("electron");

async function login() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const errorMessage = document.getElementById("errorMessage");

    if (!username || !password) {
        errorMessage.textContent = "请输入账号和密码";
        errorMessage.style.display = "block";
        return;
    }

    try {
        const result = await ipcRenderer.invoke("login", { username, password });
        if (result.success) {
            // 登录成功，将登录信息保存到本地缓存
            localStorage.setItem("userName", username);
            localStorage.setItem("password", password);

            // 登录成功，跳转到主页面
            ipcRenderer.send("navigate", "index.html");
        } else {
            errorMessage.textContent = result.message;
            errorMessage.style.display = "block";
        }
    } catch (error) {
        console.log(error);
        errorMessage.textContent = "登录失败，请重试";
        errorMessage.style.display = "block";
    }
}

// 按回车键登录
document.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        login();
    }
});