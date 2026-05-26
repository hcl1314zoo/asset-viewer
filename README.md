# 本地素材预览器

一个不需要安装 Photoshop、Blender、Maya 等专业软件的本地网页工具。把素材文件拖进网页后，可以查看预览、层级结构、基础属性和简单规范检查结果。

## 支持格式

- PSD：合成预览、图层/组层级、名称、可见性、透明度、位置、尺寸、文本内容等。
- GLB/glTF：3D 预览、节点层级、网格、材质、三角面、顶点数等。
- FBX：3D 预览、节点层级、网格、材质、三角面、顶点数等。
- OBJ：3D 预览、节点层级、网格、三角面、顶点数等。

## 使用方式

### 发给大家在线使用

推荐部署到 Render 这类静态网站平台。部署后会得到一个类似下面的网址：

```text
https://your-asset-viewer.onrender.com/
```

同事打开网址后，直接把 PSD 或模型拖进页面即可。素材文件仍然只在她们自己的浏览器里解析，不会因为部署成网页就自动上传到服务器。

### Render 部署步骤

1. 把整个 `local-asset-viewer` 文件夹上传到一个 GitHub 仓库。
2. 打开 Render，新建 `Static Site` 或使用仓库里的 `render.yaml` 创建 Blueprint。
3. 连接 GitHub 仓库。
4. 如果手动创建 Static Site，使用这些配置：
   - Build Command：留空
   - Publish Directory：`.`
5. 创建完成后，Render 会生成一个 `onrender.com` 网址，把这个网址发给同事即可。

项目已经包含 `render.yaml`，Render 识别后会按静态站点发布当前目录。

### 本地临时使用

由于页面使用 ES Module 和 CDN 依赖，推荐通过本地静态服务器打开。Windows 上可以直接运行：

```powershell
cd C:\Users\admin\local-asset-viewer
powershell -ExecutionPolicy Bypass -File .\start-server.ps1 -Port 5174
```

然后在浏览器访问：

```text
http://localhost:5174
```

如果电脑已经有 Python，也可以运行：

```powershell
cd C:\Users\admin\local-asset-viewer
python -m http.server 5173
```

浏览器访问：

```text
http://localhost:5173
```

如果电脑没有 Python，也可以用 VS Code / Cursor 的 Live Server 插件，或任何能打开静态网页的本地服务器。

项目里带了一个测试文件：

```text
C:\Users\admin\local-asset-viewer\samples\cube.obj
```

打开网页后可以先拖入这个文件，确认 3D 预览和层级树是否正常。

## 隐私说明

文件通过浏览器本地读取和解析，不会上传到业务服务器。第一次打开页面需要联网加载前端依赖：

- three.js：用于 3D 预览。
- ag-psd：用于 PSD 解析。

如果公司网络不允许访问 CDN，后续可以把这些依赖下载到内网，改成完全离线版本。

## 规范检查

当前第一版会提示这些常见问题：

- PSD 图层或 3D 对象未命名。
- 图层或对象仍使用默认名称，例如 `Layer 1`、`Group 1`、`Cube`、`Object001`。
- PSD 存在隐藏图层或空组。
- 3D 模型存在空节点、未检测到材质、面数较高。
- OBJ 单文件可能缺少外部 MTL 和贴图。

## 已知限制

- PSD 的复杂图层样式、智能对象、字体效果和部分混合模式，浏览器预览可能无法和 Photoshop 完全一致。
- FBX 格式来源复杂，部分软件导出的 FBX 可能无法被 three.js 完整解析。
- OBJ 的材质通常依赖 `.mtl` 和外部贴图，第一版只处理单个 OBJ 文件。
- 大文件会占用较多内存，FBX 解析可能短时间卡住页面。

## 后续建议

- 支持同时拖入 `.obj + .mtl + 贴图`。
- 支持导出 HTML 或 JSON 检查报告。
- 增加公司内部命名规则配置。
- 把 CDN 依赖改成本地依赖，做成完全离线包。
