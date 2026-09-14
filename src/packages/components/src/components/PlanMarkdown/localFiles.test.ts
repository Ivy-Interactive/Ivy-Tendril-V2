import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transformLocalFileUrl } from "./localFiles";

describe("localFiles", () => {
  const setMeta = (name: string, content: string) => {
    const el = document.createElement("meta");
    el.name = name;
    el.content = content;
    document.head.appendChild(el);
  };

  beforeEach(() => {
    setMeta("ivy-host", "http://localhost:5000");
    setMeta("ivy-dangerously-allow-local-files", "true");
  });

  afterEach(() => {
    document.head.querySelectorAll("meta").forEach((el) => el.remove());
  });

  describe("transformLocalFileUrl", () => {
    it("transforms Unix file:// URL to proxy URL with absolute path", () => {
      const input = "file:///Users/foo/image.png";
      const result = transformLocalFileUrl(input, "src");
      expect(result).toBe("http://localhost:5000/ivy/local-file?path=%2FUsers%2Ffoo%2Fimage.png");
    });

    it("transforms Windows file:// URL to proxy URL without leading slash", () => {
      const input = "file:///C:/Users/foo/image.png";
      const result = transformLocalFileUrl(input, "src");
      expect(result).toBe(
        "http://localhost:5000/ivy/local-file?path=C%3A%2FUsers%2Ffoo%2Fimage.png",
      );
    });

    it("transforms bare Windows path to proxy URL", () => {
      const input = "D:\\Screenshots\\img.png";
      const result = transformLocalFileUrl(input, "src");
      expect(result).toBe("http://localhost:5000/ivy/local-file?path=D%3A%2FScreenshots%2Fimg.png");
    });

    it("handles URL-encoded characters in Unix paths", () => {
      const input = "file:///Users/foo/image%20with%20spaces.png";
      const result = transformLocalFileUrl(input, "src");
      expect(result).toBe(
        "http://localhost:5000/ivy/local-file?path=%2FUsers%2Ffoo%2Fimage%20with%20spaces.png",
      );
    });

    it("handles URL-encoded characters in Windows paths", () => {
      const input = "file:///C:/Users/foo/image%20with%20spaces.png";
      const result = transformLocalFileUrl(input, "src");
      expect(result).toBe(
        "http://localhost:5000/ivy/local-file?path=C%3A%2FUsers%2Ffoo%2Fimage%20with%20spaces.png",
      );
    });

    it("preserves file:// URLs for href attributes", () => {
      const input = "file:///Users/foo/image.png";
      const result = transformLocalFileUrl(input, "href");
      expect(result).toBe("file:///Users/foo/image.png");
    });

    it("converts Windows path to file:// for href attributes", () => {
      const input = "D:\\Screenshots\\img.png";
      const result = transformLocalFileUrl(input, "href");
      expect(result).toBe("file:///D:/Screenshots/img.png");
    });
  });
});
