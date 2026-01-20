/**
 * Base HTML layout template with Tailwind CSS
 */

export interface LayoutOptions {
  title: string;
  content: string;
  /** Current path for nav highlighting (e.g., "/statements") */
  activePath?: string;
}

interface NavLink {
  label: string;
  href: string;
}

const navLinks: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "Statements", href: "/statements" },
  { label: "Import", href: "/statements/import" },
];

function renderNavbar(activePath?: string): string {
  const links = navLinks
    .map((link) => {
      const isActive = activePath === link.href;
      const baseClasses = "px-4 py-2 text-sm font-medium rounded-lg transition-colors";
      const activeClasses = isActive
        ? "text-gray-900 bg-gray-100 dark:text-gray-100 dark:bg-gray-800"
        : "text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800";
      return `<a class="${baseClasses} ${activeClasses}" href="${link.href}">${link.label}</a>`;
    })
    .join("");

  return `
    <nav class="flex items-center px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50 -mx-4 -mt-8 mb-8">
      <a class="text-xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight" href="/">Fin</a>
      <div class="flex items-center gap-1 mx-auto">
        ${links}
      </div>
      <div class="w-12"></div>
    </nav>
  `;
}

/** Tailwind config for dark mode and custom colors */
const tailwindConfig = `
  tailwind.config = {
    darkMode: 'media',
    theme: {
      extend: {
        fontFamily: {
          sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
          mono: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
        },
      },
    },
  }
`;

export function layout({ title, content, activePath }: LayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Fin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>${tailwindConfig}</script>
</head>
<body class="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans antialiased">
  <div class="max-w-4xl mx-auto px-4 py-8">
    ${renderNavbar(activePath)}
    ${content}
  </div>
</body>
</html>`;
}
