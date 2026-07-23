// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import remarkHeadingId from "remark-heading-id";
import starlightLinksValidator from "starlight-links-validator";

export default defineConfig({
  site: "https://tgerke.github.io",
  base: "/lims-core",
  markdown: {
    remarkPlugins: [remarkHeadingId],
  },
  integrations: [
    starlight({
      title: "lims-core",
      description:
        "An open-source Laboratory Information Management System for clinical research, where the audit trail, e-signatures, and chain of custody are properties of the database",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/tgerke/lims-core" }],
      customCss: ["./src/styles/custom.css"],
      components: {
        Footer: "./src/components/Footer.astro",
      },
      plugins: [starlightLinksValidator({ errorOnLocalLinks: false })],
      sidebar: [
        {
          label: "Getting started",
          items: ["getting-started"],
        },
        {
          label: "Biobank workflow",
          items: [
            "user-guide/accessioning",
            "user-guide/storage-and-custody",
            "user-guide/biobank-operations",
            "user-guide/shipments-and-kits",
          ],
        },
        {
          label: "Analytical and QC",
          items: [
            "user-guide/orders-and-results",
            "user-guide/analytical-testing",
            "user-guide/quality-control",
          ],
        },
        {
          label: "Inventory and reporting",
          items: ["user-guide/inventory", "user-guide/reports"],
        },
        {
          label: "Compliance and security",
          items: [
            "compliance",
            "user-guide/signatures",
            "user-guide/audit-trail",
            "user-guide/roles",
          ],
        },
        {
          label: "About the project",
          items: ["why-lims-core", "user-guide", "roadmap", "glossary"],
        },
      ],
    }),
  ],
});
