/*
 * @Author: 周克朋 15538308935@163.com
 * @Date: 2025-02-27 17:31:19
 * @LastEditors: 周克朋 15538308935@163.com
 * @LastEditTime: 2025-07-05 16:00:24
 * @FilePath: \usb-file-monitor\src\main.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// 引入index.js
const indexJS = require("./index.js");

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { MongoClient } = require("mongodb");

// MongoDB 连接配置
const mongoConfig = {
    url: "mongodb://localhost:27017",
    dbName: "usbMonitor",
    options: {
        // useNewUrlParser: true,
        // useUnifiedTopology: true
    }
};

let mainWindow = null;
let loginWindow = null;

// 创建登录窗口
function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 320,
        height: 480,
        icon: path.join(__dirname, "../src/static/images/file-management-icon.png"),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        closable: true,
        frame: false,
        transparent: false,
        resizable: false
    });

    loginWindow.loadFile("src/login.html");

    loginWindow.on("closed", () => {
        loginWindow = null;
    });
}

// 当应用准备就绪时，创建登录窗口
app.whenReady().then(createLoginWindow);

// 处理登录请求
ipcMain.handle("login", async(event, { username, password }) => {
    try {
        const client = await MongoClient.connect(
            mongoConfig.url,
            mongoConfig.options
        );
        const db = client.db(mongoConfig.dbName);
        const collection = db.collection("user");

        // 根据用户名查询用户
        const user = await collection.findOne({ username });

        if (!user) {
            // 用户不存在，自动创建
            await collection.insertOne({ username, password });
            return { success: true, message: "用户不存在，已自动创建并登录成功" };
        }

        // 验证密码
        if (user.password === password) {
            return { success: true, message: "登录成功" };
        } else {
            return { success: false, message: "账号或密码错误" };
        }
    } catch (error) {
        console.error("登录处理出错:", error);
        return { success: false, message: "登录处理出错，请稍后重试" };
    }
});

// 处理页面导航
ipcMain.on("navigate", (event, page) => {
    if (page === "index.html") {
        // 执行index.js中的createWindow方法
        indexJS.createWindow();
        if (loginWindow) {
            loginWindow.close();
        }
    }
});

// 处理关闭窗口请求
ipcMain.on("close-window", (event) => {
    if (loginWindow) {
        loginWindow.close();
    }
    if (mainWindow) {
        mainWindow.close();
    }
});

// 处理窗口关闭事件
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createLoginWindow();
    }
});

// Add this handler
ipcMain.on("open-file-changes", () => {
    const logWindow = new BrowserWindow({
        width: 400,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js")
        },
        frame: true,
        transparent: true,
        closable: true,
        resizable: true
    });

    logWindow.loadFile("src/renderer/file-changes.html");
    logWindow.on("closed", () => {
        logWindow = null;
    });
});