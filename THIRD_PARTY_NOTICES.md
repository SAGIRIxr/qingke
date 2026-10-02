# 第三方组件

课表 PDF 在本机使用 PDF.js legacy 解析。PDF.js、CMap 和标准字体资源随应用打包，许可证保留在原资源目录：

- PDF.js：Apache License 2.0，见 `www/vendor/pdfjs/LICENSE`。
- 字符映射：见 `www/vendor/pdfjs/cmaps/LICENSE`。
- Liberation 与 Foxit 标准字体：见 `www/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION` 和 `LICENSE_FOXIT`。

后端生产运行使用 Gunicorn。依赖版本和下载哈希见 `server/requirements.txt`，其源码和许可证由原项目提供。

默认更新代理是可关闭、可替换的第三方网络服务。应用对下载的安装包另行检查包名、版本、SHA-256 和与当前安装版本一致的签名证书，不将代理视为签名信任来源。
