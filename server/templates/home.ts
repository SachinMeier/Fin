/**
 * Home page template
 */

import { layout } from "./layout.js";
import { renderLinkButton, ButtonVariant } from "./button.js";

interface HomeLink {
  label: string;
  href: string;
  variant: ButtonVariant;
}

const links: HomeLink[] = [
  { label: "Get Started", href: "/instructions", variant: "proceed" },
  { label: "View Statements", href: "/statements", variant: "normal" },
];

export function renderHomePage(): string {
  const linkItems = links
    .map(
      (link) => `
        <li>
          ${renderLinkButton({ label: link.label, href: link.href, variant: link.variant })}
        </li>
      `
    )
    .join("");

  const content = `
    <div class="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 class="text-5xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Fin</h1>
      <p class="text-lg text-gray-500 dark:text-gray-400 mb-12 max-w-md">
        A quiet tool for organizing your personal finances.
      </p>
      <ul class="flex flex-col gap-4">
        ${linkItems}
      </ul>
    </div>
  `;

  return layout({
    title: "Home",
    content,
    activePath: "/",
  });
}
