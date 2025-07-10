// main.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { MongoClient } = require("mongodb");
const { execFile } = require("child_process");
const indexJS = require("./index");
const { logger } = require("./util/index.js");
// MongoDB配置文件路径
const CONFIG_FILE_PATH = path.join(
    app.getPath("userData"),
    "mongo-config.json"
);
// MongoDB配置
let mongoConfig = {
    url: "",
    dbName: "",
    options: {}
};

let mainWindow = null;
let loginWindow = null;
let mongoSettingsWindow = null;

// 创建MongoDB设置窗口
function createMongoSettingsWindow() {
    if (mongoSettingsWindow) {
        mongoSettingsWindow.focus();
        return;
    }

    mongoSettingsWindow = new BrowserWindow({
        width: 400,
        height: 300,
        resizable: false,
        modal: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        frame: false,
        transparent: false,
        resizable: false
    });

    mongoSettingsWindow.loadFile("src/renderer/mongo-settings.html");

    // 监听窗口关闭事件
    mongoSettingsWindow.on("closed", () => {
        mongoSettingsWindow = null;
    });

    // 加载已保存的设置
    ipcMain.on("load-mongo-settings", (event) => {
        event.sender.send(
            "mongo-settings-loaded",
            savedConfig ? JSON.parse(savedConfig) : null
        );
    });

    // 关闭设置窗口
    ipcMain.on("close-mongo-settings", () => {
        if (mongoSettingsWindow) {
            mongoSettingsWindow.close();
        }
    });
}

// 创建登录窗口
function createLoginWindow() {
    loginWindow = new BrowserWindow({
        width: 320,
        height: 480,
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
// 加载MongoDB配置（从磁盘文件）
ipcMain.handle("load-mongo-settings", async() => {
    logger.info("load-mongo-settings");
    try {
        // 使用PowerShell读取JSON文件
        const result = await executePowerShellScript(
            `Get-Content -Path '${CONFIG_FILE_PATH}' | ConvertFrom-Json | ConvertTo-Json`
        );
        const jsonObj = JSON.parse(result.stdout.trim());
        logger.info(jsonObj);
        mongoConfig.url = jsonObj ? jsonObj.url : "";
        mongoConfig.dbName = jsonObj ? jsonObj.dbName : "";
        return jsonObj;
    } catch (error) {
        logger.info("读取配置文件失败" + error);
        return null; // 返回null表示配置文件不存在或读取失败
    }
});

// 保存MongoDB配置（通过PowerShell写入磁盘）
ipcMain.handle("save-mongo-settings", async(event, settings) => {
    try {
        const jsonContent = JSON.stringify(settings, null, 2);
        const encodedContent = Buffer.from(jsonContent).toString("base64");

        // 使用PowerShell写入JSON文件（Base64编码避免特殊字符问题）
        await executePowerShellScript(`
            $content = [System.Convert]::FromBase64String('${encodedContent}')
            [System.IO.File]::WriteAllBytes('${CONFIG_FILE_PATH}', $content)
        `);
        logger.info("配置已保存到:" + CONFIG_FILE_PATH);
        mongoConfig.url = settings ? settings.url : "";
        mongoConfig.dbName = settings ? settings.dbName : "";
        return true;
    } catch (error) {
        logger.error("保存配置文件失败:" + error);
        throw error;
    }
});

// 执行PowerShell脚本
function executePowerShellScript(script) {
    return new Promise((resolve, reject) => {
        const powershell = execFile(
            "powershell.exe", ["-Command", script], { maxBuffer: 1024 * 1024 }, // 增加缓冲区大小
            (error, stdout, stderr) => {
                if (error) {
                    console.error("PowerShell错误:", stderr);
                    reject(new Error(`PowerShell执行失败: ${stderr}`));
                    return;
                }
                resolve({ stdout, stderr });
            }
        );
    });
}
// 打开MongoDB设置窗口的IPC处理
ipcMain.on("open-mongo-settings", createMongoSettingsWindow);