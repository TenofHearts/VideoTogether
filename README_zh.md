# VideoTogether

<img src="./assets/img/image.png" alt="VideoTogether Banner" width="760" />

<p align="center">
  <a href="https://github.com/TenofHearts/VideoTogether/releases"><img src="https://img.shields.io/badge/release-v1.4.0-orange" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue
  " alt="Apache 2.0 License"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/Language-English-green"></a>
</p>

VideoTogether 是一个面向局域网内两人私密观影场景的视频同步应用。

主机端在本机导入视频文件，使用 `ffprobe` / `ffmpeg` 处理成 HLS 流，创建私密房间链接，然后把链接发给另一位观看者。观看者不需要安装桌面端，只需要用浏览器打开房间链接即可。

当前主打的是“本机启动、快速分享、两人同步播放”的使用方式。

## 功能概览

当前已实现：

- 本地视频导入
- `ffprobe` 媒体探测
- `ffmpeg` HLS 转码与切片
- `.srt`、`.vtt`、`.ass` 字幕导入与转换
- 私密房间创建与分享链接
- 浏览器端房间播放
- 两人同步 `play / pause / seek`
- 房间级字幕切换同步
- 参与者在线状态与重连恢复
- Tauri 桌面端主机控制面板
- 一键启动主机流程

## 项目结构

```text
apps/
  desktop/   Tauri 桌面端主机控制台
  server/    Fastify + Socket.IO + SQLite + FFmpeg 服务端
  web/       浏览器端播放与房间页面
packages/
  shared-types/
  shared-schemas/
  shared-utils/
storage/
  media/     上传的原始视频
  hls/       生成的 HLS 清单与分片
  subtitles/ 转换后的字幕文件
  db/        SQLite 数据库
  temp/      临时处理目录
infra/
  docker-compose.yml
  scripts/   启动、停止、打包脚本
```

## 面向普通用户（Windows）

你可以直接在 Windows 系统上安装 VideoTogether：
1. 请前往 [Releases](https://github.com/TenofHearts/VideoTogether/releases) 页面下载最新的 Windows 安装包（`.exe`）。
2. 双击运行安装程序，按提示完成安装。
3. 在 `.env.example` 中配置你的 IP 地址。
4. 从开始菜单启动 VideoTogether 即可使用。

### IP 配置

打开你常用的终端（例如 powershell），输入以下命令：

```powershell
> ipconfig
```

你会在输出结果中找到你的 IPv4 地址，看起来像这样：

```
以太网适配器 以太网:

   连接特定的 DNS 后缀 . . . . . . . :
   IPv6 地址 . . . . . . . . . . . . : xxxx:xxxx:xxxx:xxxx::xxxx
   本地链接 IPv6 地址. . . . . . . . : fe80::xxxx:xxxx:xxxx:xxxx%xx
   IPv4 地址 . . . . . . . . . . . . : 10.x.x.x
   子网掩码  . . . . . . . . . . . . : 255.255.240.0
   默认网关. . . . . . . . . . . . . : fe80::xxxx:xxxx:xxxx:xxxx%xx
                                       10.x.x.x
```

你需要复制这个 IPv4 地址，并将它~~粘贴到 `.env.example` 文件中~~输入到应用中 `LAN IP` 输入框内：

```env
...
LAN_IP=10.x.x.x
...
```

完成这些之后就可以了！

#### 关于 ZeroTier 的说明

正如后文所述，如果你想和不在同一个物理局域网内的人共享视频，你需要用到 ZeroTier。在这种情况下，你需要：
1. 下载并安装 ZeroTier
2. 和你想共享视频的人加入同一个虚拟局域网
3. ~~将你在 ZeroTier 面板中分配到的 IP 地址设置为 `.env.example` 中的 `LAN_IP`。~~ 运行应用并配置你的局域网IP
4. 和你的朋友一起看电影吧!

成功配置 ZeroTier 后，运行 `ipconfig` 你应该会看到类似如下的信息：
```
以太网适配器 ZeroTier One [xxxxxxxxxxxxxxxx]:

   连接特定的 DNS 后缀 . . . . . . . :
   本地链接 IPv6 地址. . . . . . . . : fe80::xxxx:xxxx:xxxx:xxxx%xx
   IPv4 地址 . . . . . . . . . . . . : 10.x.x.x
   子网掩码  . . . . . . . . . . . . : 255.255.255.0
   默认网关. . . . . . . . . . . . . : 25.x.x.x
```
这个结果中的 IPv4 地址应该和你自己在 ZeroTier 中的 IP 地址一致。

## 面向开发者

### 运行依赖

在主机电脑上需要准备：

- Node.js 22+
- npm 11+
- `ffmpeg`
- `ffprobe`
- Rust / Tauri Windows 构建环境
  - 开发桌面端或打包桌面安装包时需要
- Docker Desktop
  - 仅当 `USE_DOCKER=true` 时需要

### 环境变量

推荐从 `.env.example` 开始。

核心变量如下：

- `USE_DOCKER`
  - 控制主机启动脚本是否使用 Docker 启动 server
  - 默认 `false`
- `HOST`
  - server 监听地址
  - 如果要让局域网或 ZeroTier 里的 guest 连进来，请使用 `0.0.0.0`
  - 默认 `0.0.0.0`
- `PORT`
  - 本地 server 监听端口
  - 默认 `3000`
- `PUBLIC_PROTOCOL`
  - 生成公开分享链接时使用的协议
  - 默认 `http`
- `PUBLIC_HOST`
  - 生成公开分享链接时使用的主机名
  - 默认 `localhost`
- `WEB_DEV_PORT`
  - `npm run dev` 时 Vite 开发服务器使用的端口
  - 默认 `5173`
- `LAN_IP`
  - 桌面端生成局域网房间链接时使用的固定 IPv4
  - 请把它设置成你明确要暴露的地址，比如 ZeroTier IPv4
- `FFMPEG_PATH`
  - `ffmpeg` 可执行文件路径
- `FFPROBE_PATH`
  - `ffprobe` 可执行文件路径

当前 `.env.example` 的默认思路是：

- 开发模式前端地址：`http://localhost:5173`
- 生产式本机 host 流程地址：`http://localhost:3000`
- Docker 默认关闭
- 局域网 URL 只使用固定配置的 `LAN_IP`

### 安装依赖

在仓库根目录执行：

```bash
npm install
```

## 推荐使用方式

### 1. 启动主机流程

```bash
npm run host:start
```

这个命令会：

- 构建 `web` 生产产物
- 构建 `server` 生产产物
- 启动本机生产模式 server
- 打开 Tauri 桌面端主机控制面板

默认行为：

- 不使用 Docker
- 分享链接默认指向 `http://localhost:3000`
- 局域网房间链接只从 `LAN_IP` 生成

停止主机流程：

```bash
npm run host:stop
```

这个命令会停止由 `host:start` 拉起的后台本地 server 进程树。

如果你只想启动本机 server，不打开桌面端：

```bash
npm run host:start -- -SkipDesktop
```

### 2. 使用桌面端主机控制台

桌面端里的推荐流程：

1. 选择本地视频文件，或者从已有媒体库中复用视频
2. 等待处理完成
3. 可选地上传字幕文件
4. 选择房间默认字幕
5. 设置主机昵称与房间过期时间
6. 创建房间
7. 复制分享链接并发送给另一位观看者

桌面端还提供：

- 视频处理状态
- 媒体元数据
- 房间状态
- 参与者在线状态
- 字幕更新
- 房间关闭
- 无用媒体删除
- 本机 URL 和局域网 URL 复制

如果你希望桌面端生成局域网 URL，请把 `LAN_IP` 设置成你想使用的准确 IPv4，例如你的 ZeroTier IPv4。应用不会自动探测局域网 IP。

如果 host 本机能打开房间，但 guest 打不开，先检查 `HOST=0.0.0.0`，然后把桌面端里的 `LAN room URL` 发给 guest，而不是 `localhost` 链接。

### 3. 观看者如何使用

观看者不需要桌面端。

只需要：

1. 用浏览器打开房间链接
2. 输入显示名称
3. 加入房间
4. 观看同步播放的视频

## Docker 是可选项

如果你想让 `host:start` 通过 Docker 运行 server，请设置：

```bash
USE_DOCKER=true
```

然后仍然执行同一个命令：

```bash
npm run host:start
```

此时脚本会：

- 使用 `infra/docker-compose.yml`
- 在容器中运行 server
- 挂载本地 `storage/*` 目录
- 保持桌面端仍在宿主机运行

## 本地开发模式

如果你想分别调试 web、server、desktop：

```bash
npm run dev:server
npm run dev:web
npm run dev:desktop
```

默认开发地址：

- API: `http://localhost:3000`
- Web: `http://localhost:5173`
- Desktop dev shell: `npm run dev:desktop`

## 常用命令

- `npm run host:start`
  - 构建 `web` 和 `server` 的生产产物，启动本地主机 server，并打开 Tauri 桌面端控制面板
- `npm run host:stop`
  - 停止由 `host:start` 拉起的后台 server 进程树
- `npm run host:start -- -SkipDesktop`
  - 只启动本地主机 server，不打开桌面端
- `npm run desktop:package`
  - 构建 Tauri 桌面端安装包
- `npm run dev:server`
  - 以开发 watch 模式运行 Fastify server
- `npm run dev:web`
  - 以开发模式运行 Vite web 应用
- `npm run dev:desktop`
  - 以开发模式运行 Tauri 桌面端
- `npm run build:host`
  - 构建 `apps/web` 和 `apps/server` 的生产产物
- `npm run lint`
  - 对所有定义了 lint 脚本的 workspace 执行 ESLint
- `npm run typecheck`
  - 对所有 workspace 执行 TypeScript 类型检查，并且不产出构建文件

## 路由与接口

健康检查：

- `GET /health`
- `GET /api/system/status`

房间接口：

- `POST /api/rooms`
- `GET /api/rooms/:token`
- `POST /api/rooms/:token/join`
- `POST /api/rooms/:token/subtitle`
- `POST /api/rooms/:token/close`

媒体接口：

- `GET /api/media`
- `POST /api/media/import`
- `GET /api/media/:id`
- `DELETE /api/media/:id`
- `POST /api/media/:id/process`
- `POST /api/media/:id/subtitles`
- `GET /api/media/:id/subtitles`

静态播放资源：

- `GET /media/:mediaId/*`
- `GET /subtitles/:subtitleId.vtt`
- `GET /`
- `GET /room/:token`

## 使用建议

可以使用 [zerotier](https://www.zerotier.com/) 来实现不在同一个物理局域网内的视频播放

# 许可证

本项目采用 Apache License 2.0 许可发布，详情请参见 `LICENSE` 文件。

本项目使用了 [FFmpeg](https://ffmpeg.org)（由 GNU Lesser General Public License (LGPL) v2.1 许可授权）。