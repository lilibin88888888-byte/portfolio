# 个人简历作品集网站

纯静态个人简历 + 作品集网站，部署在 GitHub Pages，支持浏览器内全内容增删改查。

## 项目结构

```
├── index.html          # 主页面
├── data.js             # 所有内容数据（简历文字 + 项目图片 base64）
├── css/
│   └── style.css       # 样式
└── js/
    └── app.js          # 渲染逻辑 + CRUD + 图片压缩 + 导入导出
```

## 部署到 GitHub Pages

1. 在 GitHub 创建仓库，名称随意（如 `portfolio`）
2. 将本目录所有文件推送到仓库 `main` 分支
3. 进入仓库 Settings > Pages，Source 选 `main` 分支，目录选 `/ (root)`
4. 保存后等待 1-2 分钟，访问 `https://<用户名>.github.io/<仓库名>/` 即可

## 如何编辑内容

### 方式一：网页编辑（推荐）

1. 打开网站，点击右上角「编辑模式」
2. 点击虚线框内的文字可直接编辑
3. 使用各模块的「+ 添加」「编辑」「删除」按钮管理项目、工作经历、教育经历
4. 编辑项目时可以上传图片（自动压缩）
5. 编辑完成后点击顶部紫色条的「导出数据」，下载新的 `data.js`
6. 用下载的文件替换仓库中的 `data.js`，push 到 GitHub 即可生效

### 方式二：直接编辑 data.js

用任意文本编辑器打开 `data.js`，直接修改 JSON 内容。

## 图片管理

- 图片以 base64 格式存储在 `data.js` 的项目 `images` 数组中
- 上传时会自动压缩到 1200px 宽度、70% 质量
- 建议单个项目图片不超过 10 张，每张压缩后约 100-300KB
- 如果 data.js 文件过大（>5MB），考虑减少图片数量或降低压缩质量

## 技术栈

- 纯 HTML + CSS + JavaScript，无框架依赖
- 数据驱动渲染，单文件数据存储
- 图片上传自动压缩（Canvas API）
- LocalStorage 草稿自动保存

## 自定义

- 修改配色：编辑 `css/style.css` 顶部的 `:root` CSS 变量
- 修改导航品牌名：编辑 `index.html` 中的 `.nav-brand`
- 修改字体：替换 Google Fonts 链接和 `--font-display` 变量
