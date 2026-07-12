import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./app.js";
import { AuditTrailPage } from "./pages/audit.js";
import { InventoryPage } from "./pages/inventory.js";
import { KitsPage } from "./pages/kits.js";
import { LoginPage } from "./pages/login.js";
import { QcReviewPage } from "./pages/qc-review.js";
import { ReportsPage } from "./pages/reports.js";
import { SampleDetailPage } from "./pages/sample-detail.js";
import { SamplesPage } from "./pages/samples.js";
import { ShipmentDetailPage } from "./pages/shipment-detail.js";
import { ShipmentsPage } from "./pages/shipments.js";
import { StoragePage } from "./pages/storage.js";
import { WorksheetDetailPage } from "./pages/worksheet-detail.js";
import { WorksheetsPage } from "./pages/worksheets.js";

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/samples" });
  },
});

const samplesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/samples",
  component: SamplesPage,
});

const sampleDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/samples/$sampleId",
  component: SampleDetailPage,
});

const shipmentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/shipments",
  component: ShipmentsPage,
});

const shipmentDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/shipments/$shipmentId",
  component: ShipmentDetailPage,
});

const kitsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/kits",
  component: KitsPage,
});

const storageRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/storage",
  component: StoragePage,
});

const inventoryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/inventory",
  component: InventoryPage,
});

const worksheetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/worksheets",
  component: WorksheetsPage,
});

const worksheetDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/worksheets/$worksheetId",
  component: WorksheetDetailPage,
});

const qcReviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/qc-review",
  component: QcReviewPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/reports",
  component: ReportsPage,
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/audit",
  component: AuditTrailPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    samplesRoute,
    sampleDetailRoute,
    shipmentsRoute,
    shipmentDetailRoute,
    kitsRoute,
    storageRoute,
    inventoryRoute,
    worksheetsRoute,
    worksheetDetailRoute,
    qcReviewRoute,
    reportsRoute,
    auditRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
