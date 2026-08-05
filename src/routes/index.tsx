import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chrome Extension Starter" },
      { name: "description", content: "A blank Chrome extension starter project. Download the packaged extension and load it into Chrome." },
      { property: "og:title", content: "Chrome Extension Starter" },
      { property: "og:description", content: "A blank Chrome extension starter project. Download the packaged extension and load it into Chrome." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const download = () => {
    fetch("/chrome-extension.zip")
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "chrome-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => alert(err.message));
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="mx-auto max-w-xl text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 12h.01" />
              <path d="M8 20l4-8 4 8M6 4l4 8 4-8" />
            </svg>
          </div>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Chrome Extension Starter
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          A blank Chrome extension project ready to customize. Download the package, unzip it, and load it as an unpacked extension in Chrome.
        </p>

        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <button
            onClick={download}
            className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Download extension
          </button>
          <a
            href="https://docs.lovable.dev/features/chrome-extension"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            View docs
          </a>
        </div>

        <div className="mt-12 rounded-lg border border-border bg-card p-6 text-left text-card-foreground">
          <h2 className="mb-4 text-lg font-semibold">Installation</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Download and unzip the extension file.</li>
            <li>Open Chrome and navigate to chrome://extensions.</li>
            <li>Enable Developer mode in the top-right corner.</li>
            <li>Click Load unpacked and select the unzipped folder.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
