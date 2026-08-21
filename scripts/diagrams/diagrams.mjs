// diagrams.mjs
//
// The four diagrams. Every fact here is traceable to the repository:
//   infrastructure/*.tf, apps/*.tf, src/Fcmr.Router.Decisions/*.cs,
//   docs/architecture.md, docs/agent-architecture.md, docs/ui-design.md,
//   docs/demo-runbook.md, .specify/memory/constitution.md,
//   specs/001-router-core/**, specs/002-governed-exchange/**.

import { Scene, C, FONT, columns } from './diagram-kit.mjs';

const MONO = FONT.mono;

/** Uniform height for a row of sibling boxes, computed from the widest content. */
function rowHeight(items, colWidth) {
  return Math.max(...items.map((s) => Scene.measure(s, colWidth)));
}

/** Place a row of boxes across a column ruler at a shared height. */
function placeRow(scene, ruler, y, items, common = {}) {
  const w = ruler.at(0).width;
  const specs = items.map((s) => ({ ...common, ...s }));
  const h = rowHeight(specs, w);
  return specs.map((s, i) => scene.box({ ...s, x: ruler.at(i).x, y, width: w, height: h }));
}

const LEGEND_PRIVATE = {
  stroke: C.green,
  background: C.bgGreen,
  text: 'Inside the VNet / private endpoint only. No public data-plane endpoint.',
};
const LEGEND_PUBLIC = {
  stroke: C.red,
  background: C.bgRed,
  text: 'Public or refusal / denial. The single public surface, or a governed "no".',
};
const LEGEND_HUMAN = {
  stroke: C.orange,
  background: C.bgYellow,
  text: 'Human-in-the-loop. A person, holding a distinct identity, decides.',
};
const LEGEND_PREVIEW = {
  stroke: C.violet,
  background: C.bgViolet,
  text: 'Preview Azure capability (azapi, preview API version).',
};
const LEGEND_CHOKEPOINT = {
  stroke: C.blue,
  background: C.bgBlue,
  text: 'Governed chokepoint / deterministic code the exchange depends on.',
};
const LEGEND_ABSENT = {
  stroke: C.red,
  background: C.white,
  strokeStyle: 'dashed',
  text: 'Described in docs but ABSENT from infrastructure/*.tf and apps/*.tf.',
};

// ===========================================================================
// 01 — Platform topology
// ===========================================================================

export function platformTopology() {
  const scene = new Scene({ name: '01-platform-topology', seed: 0x11a2b3c4 });
  const X0 = 80;
  const W = 2560;
  const INNER_X = X0 + 40;
  const INNER_W = W - 80;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '01 · Governed AI Exchange — private Azure platform topology',
    subtitle:
      'Conclusion: every data plane in this system — Cosmos, AI Search, Key Vault, the registry and Microsoft Foundry — is reachable only from inside the VNet, and the sole public surface is the demo UI front door.',
  });

  // ---- Public zone -------------------------------------------------------
  const pubY = 200;
  const pubCols = columns({ x: INNER_X, count: 3, width: (INNER_W - 2 * 40) / 3, gap: 40 });
  const pubItems = [
    {
      title: 'Demo operator (browser)',
      body: 'Entra ID interactive sign-in via MSAL.\nTwo identities on the day: one holding\nApprover, one deliberately without it.',
    },
    {
      title: 'Microsoft Entra ID  ·  identity plane',
      body:
        'apps/entra.tf — one app registration, three app roles:\nRouter.Invoke (Application), Router.Read (User+App), Approver (User).\nDeliberately a public endpoint: it is an identity plane, not a data plane.',
    },
    {
      title: 'Azure control plane  ·  Terraform',
      body:
        'Two stacks, remote state: infrastructure/ (platform)\nand apps/ (workloads). Control-plane access is not\nwhat Principle II constrains — data planes are.',
    },
  ];
  const pubBoxY = pubY + 76;
  const pubH = rowHeight(pubItems, pubCols.at(0).width);
  scene.group({
    x: X0,
    y: pubY,
    width: W,
    height: 76 + pubH + 34,
    label: 'PUBLIC INTERNET',
    sublabel: 'Nothing below this line reaches an Azure data plane directly.',
    stroke: C.red,
    background: C.bgRed,
    fillStyle: 'solid',
    strokeWidth: 3,
    strokeStyle: 'dashed',
  });
  const pub = placeRow(scene, pubCols, pubBoxY, pubItems, {
    stroke: C.red,
    background: C.white,
    strokeWidth: 2,
  });
  const pubZoneBottom = pubY + 76 + pubH + 34;

  // ---- VNet --------------------------------------------------------------
  const vnetY = pubZoneBottom + 150;
  const vContentTop = vnetY + 104;

  // Left: container-apps subnet
  const caSubX = INNER_X;
  const caSubW = 1180;
  const caeX = caSubX + 30;
  const caeW = caSubW - 60;
  const appX = caeX + 25;
  const appW = caeW - 50;
  const laneCols = columns({ x: appX, count: 3, width: (appW - 2 * 40) / 3, gap: 40 });

  const webuiSpec = {
    title: 'webui  ·  Vite / React  ·  EXTERNAL ingress',
    body:
      'apps/container-apps.tf — the only container app with\nexternal_enabled = true. This is the single public surface\nallowed by Principle II.',
  };
  const routerSpec = {
    title: 'router-service  ·  the chokepoint',
    body:
      'The only workload identity holding "Azure AI Developer" on the\nFoundry project (apps/roles.tf). Every model call in the system\npasses through POST /v1/route. Internal ingress only.',
  };
  const laneSpecs = [
    {
      title: 'research-service',
      body: 'Search Index Data Reader.\nNo Foundry role assignment.',
    },
    {
      title: 'surveillance-service',
      body: 'Search Index Data Reader.\nNo Foundry role assignment.',
    },
    {
      title: 'orderrouting-service',
      body: 'Simulated OMS only.\nNo Foundry role assignment.',
    },
  ];

  const hWebui = Scene.measure(webuiSpec, appW);
  const hRouter = Scene.measure(routerSpec, appW);
  const hLane = rowHeight(laneSpecs, laneCols.at(0).width);
  const caeH = 76 + hWebui + 40 + hRouter + 40 + hLane + 30;
  const caSubH = 82 + caeH + 30;

  // Right: private-endpoints subnet
  const peSubX = caSubX + caSubW + 240;
  const peSubW = INNER_X + INNER_W - peSubX;
  const peCols = columns({ x: peSubX + 30, count: 2, width: (peSubW - 60 - 40) / 2, gap: 40 });
  const peItems = [
    { title: 'cosmos-pe', body: 'group: Sql\nprivatelink.documents.azure.com' },
    { title: 'search-pe', body: 'group: searchService\nprivatelink.search.windows.net' },
    { title: 'keyvault-pe', body: 'group: vault\nprivatelink.vaultcore.azure.net' },
    { title: 'registry-pe', body: 'group: registry\nprivatelink.azurecr.io' },
    { title: 'foundry-pe', body: 'group: account\nprivatelink.services.ai.azure.com' },
    {
      title: 'Private DNS  ·  6 zones',
      body: 'All six linked to the VNet\n(privatelink.openai.azure.com is\ncreated but has no endpoint).',
      stroke: C.blue,
      background: C.bgBlue,
    },
  ];
  const peRowH = [0, 1, 2].map((r) =>
    rowHeight(peItems.slice(r * 2, r * 2 + 2), peCols.at(0).width),
  );
  const peSubH = 82 + peRowH[0] + 40 + peRowH[1] + 40 + peRowH[2] + 30;

  const subnetRowH = Math.max(caSubH, peSubH);

  // Data planes row
  const dpY = vContentTop + subnetRowH + 70;
  const dpX = INNER_X;
  const dpW = INNER_W;
  const dpInnerX = dpX + 30;
  const dpInnerW = dpW - 60;
  const dataCols = columns({ x: dpInnerX, count: 4, width: (dpInnerW - 3 * 40) / 4, gap: 40 });
  const dataItems = [
    {
      title: 'Cosmos DB (SQL)',
      body:
        'public_network_access_enabled = false\nlocal_authentication_enabled = false\n6 containers: routerDecisions, approvals,\nsurveillanceAlerts, researchQueries,\norderProposals, auditEvents',
    },
    {
      title: 'Azure AI Search',
      body:
        'public_network_access_enabled = false\nlocal_authentication_enabled = false\nSystem-assigned identity.\nStandard SKU. Research corpus.',
    },
    {
      title: 'Key Vault',
      body:
        'public_network_access_enabled = false\nRBAC authorization, network_acls Deny.\nHolds only what cannot be managed-\nidentity authenticated (Principle VIII).',
    },
    {
      title: 'Container Registry (Premium)',
      body:
        'public_network_access_enabled = false\nadmin_enabled = false\nanonymous_pull_enabled = false\nPremium SKU is required for private link.',
    },
  ];
  const dataH = rowHeight(dataItems, dataCols.at(0).width);

  const fndX = dpInnerX;
  const fndW = 1200;
  const apimX = fndX + fndW + 40;
  const apimW = dpInnerX + dpInnerW - apimX;
  const fndInnerX = fndX + 30;
  const fndInnerW = fndW - 60;
  const fndProjSpec = {
    title: 'Foundry project  ·  fcmr-*-proj  ·  PREVIEW API',
    body:
      'accounts/projects@2026-05-15-preview, system-assigned identity.\nHosted agents run under this project identity.',
    stroke: C.violet,
    background: C.bgViolet,
  };
  const fndCols = columns({ x: fndInnerX, count: 2, width: (fndInnerW - 40) / 2, gap: 40 });
  const fndDeploySpecs = [
    {
      title: 'Serverless deployments',
      body:
        'gpt-5.4-mini · gpt-5.4 · gpt-5.6-sol\nclaude-sonnet-4-5 (Anthropic)\ngrok-4.3 (xAI)\nBilled per token.',
      stroke: C.green,
      background: C.bgGreen,
    },
    {
      title: 'Managed compute  ·  PREVIEW',
      body:
        'managedComputeDeployments@2026-05-15-preview\nnvidia-nemotron-3-nano-30b-a3b-fp8 on H100_80GB,\nGlobalManagedCompute capacity 1.\nThe only destination cleared for Restricted data.\n60m timeouts — provision ahead of the demo.',
      stroke: C.violet,
      background: C.bgViolet,
    },
  ];
  const fndDeployH = rowHeight(fndDeploySpecs, fndCols.at(0).width);
  const fndProjH = Scene.measure(fndProjSpec, fndInnerW);
  const fndH = 82 + fndProjH + 40 + fndDeployH + 30;

  const apimSpec = {
    title: 'APIM as AI gateway  —  NOT IN TERRAFORM',
    body:
      'docs/architecture.md and the constitution both require all model\ntraffic to transit APIM for token metering, cost ceilings and content\nsafety. No azurerm_api_management resource exists in either stack,\nand no private DNS zone for it is declared. Today the router calls the\nFoundry data plane directly over the foundry private endpoint.',
    stroke: C.red,
    background: C.white,
    strokeStyle: 'dashed',
    strokeWidth: 3,
  };
  const apimH = Math.max(Scene.measure(apimSpec, apimW), fndH);
  const dpH = 82 + dataH + 40 + Math.max(fndH, apimH) + 30;

  // Observability row
  const obsY = dpY + dpH + 60;
  const obsCols = columns({ x: dpInnerX, count: 2, width: (dpInnerW - 40) / 2, gap: 40 });
  const obsItems = [
    {
      title: 'Log Analytics workspace',
      body: 'PerGB2018, 30-day retention.\nBacks the Container Apps Environment.',
    },
    {
      title: 'Application Insights',
      body:
        'sampling_percentage = 100 — sampling is off so the\nscoreboard is complete inside the 5s budget (AC-5, ADR 004).\nCosmos remains the system of record for audit.',
    },
  ];
  const obsH = rowHeight(obsItems, obsCols.at(0).width);
  const obsGroupH = 82 + obsH + 30;

  const vnetH = obsY + obsGroupH + 40 - vnetY;

  // ---- emit groups (behind), then boxes (in front) -----------------------
  const vnet = scene.group({
    x: X0,
    y: vnetY,
    width: W,
    height: vnetH,
    label: 'VNET  fcmr-*-vnet   10.42.0.0/16   —   NO PUBLIC DATA-PLANE ENDPOINT',
    sublabel:
      'Principle II, enforced by scripts/policy-no-public-endpoints.sh in CI: every resource below declares public access disabled. This boundary is the compliance claim the demo rests on.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 6,
    labelSize: 28,
    sublabelSize: 18,
  });

  const caSub = scene.group({
    x: caSubX,
    y: vContentTop,
    width: caSubW,
    height: subnetRowH,
    label: 'subnet  container-apps   10.42.0.0/23',
    sublabel: 'Delegated to Microsoft.App/environments.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });
  scene.group({
    x: caeX,
    y: vContentTop + 82,
    width: caeW,
    height: caeH,
    label: 'Container Apps Environment  ·  internal load balancer',
    sublabel: 'internal_load_balancer_enabled = true. No Kubernetes (ADR 001).',
    stroke: C.blue,
    background: C.white,
    strokeWidth: 2,
  });

  const peSub = scene.group({
    x: peSubX,
    y: vContentTop,
    width: peSubW,
    height: subnetRowH,
    label: 'subnet  private-endpoints   10.42.2.0/24',
    sublabel: 'One private endpoint per data plane. infrastructure/private-endpoints.tf.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });

  const dpGroup = scene.group({
    x: dpX,
    y: dpY,
    width: dpW,
    height: dpH,
    label: 'AZURE DATA PLANES  —  publicNetworkAccess = false on every one',
    sublabel: 'Entra-only authentication; local auth and account keys disabled (Principle VIII).',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });
  scene.group({
    x: fndX,
    y: dpY + 82 + dataH + 40,
    width: fndW,
    height: fndH,
    label: 'Microsoft Foundry account  ·  kind = AIServices',
    sublabel:
      'publicNetworkAccess Disabled · disableLocalAuth true · allowProjectManagement true. Not an AI Hub workspace.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });

  scene.group({
    x: dpX,
    y: obsY,
    width: dpW,
    height: obsGroupH,
    label: 'Observability',
    sublabel:
      'Neither workspace has a private endpoint in infrastructure/*.tf — telemetry ingestion is the one data path that is not private-linked.',
    stroke: C.orange,
    background: C.white,
    strokeWidth: 3,
  });

  // boxes
  const webui = scene.box({
    ...webuiSpec,
    x: appX,
    y: vContentTop + 82 + 76,
    width: appW,
    height: hWebui,
    stroke: C.red,
    background: C.bgRed,
  });
  const router = scene.box({
    ...routerSpec,
    x: appX,
    y: vContentTop + 82 + 76 + hWebui + 40,
    width: appW,
    height: hRouter,
    stroke: C.blue,
    background: C.bgBlue,
    strokeWidth: 3,
  });
  const laneRuler = laneCols;
  const lanes = placeRow(
    scene,
    laneRuler,
    vContentTop + 82 + 76 + hWebui + 40 + hRouter + 40,
    laneSpecs,
    { stroke: C.green, background: C.bgGreen },
  );

  const peBoxes = [];
  for (let r = 0; r < 3; r += 1) {
    const y =
      vContentTop + 82 + peRowH.slice(0, r).reduce((a, b) => a + b + 40, 0);
    const slice = peItems.slice(r * 2, r * 2 + 2);
    slice.forEach((spec, i) => {
      peBoxes.push(
        scene.box({
          stroke: C.green,
          background: C.bgGreen,
          ...spec,
          x: peCols.at(i).x,
          y,
          width: peCols.at(i).width,
          height: peRowH[r],
        }),
      );
    });
  }

  const dataBoxes = placeRow(scene, dataCols, dpY + 82, dataItems, {
    stroke: C.green,
    background: C.bgGreen,
  });
  const fndProj = scene.box({
    ...fndProjSpec,
    x: fndInnerX,
    y: dpY + 82 + dataH + 40 + 82,
    width: fndInnerW,
    height: fndProjH,
  });
  placeRow(scene, fndCols, dpY + 82 + dataH + 40 + 82 + fndProjH + 40, fndDeploySpecs);
  scene.box({
    ...apimSpec,
    x: apimX,
    y: dpY + 82 + dataH + 40,
    width: apimW,
    height: apimH,
  });

  placeRow(scene, obsCols, obsY + 82, obsItems, { stroke: C.orange, background: C.bgYellow });

  // ---- arrows ------------------------------------------------------------
  const gapBandY = pubZoneBottom + 60;
  scene.arrow(pub[0], webui, {
    color: C.red,
    strokeWidth: 5,
    label: 'HTTPS — the ONLY public ingress\nanywhere in the system',
    labelWidth: 520,
    labelAt: { x: pub[0].cx - 40, y: gapBandY },
    sides: ['bottom', 'top'],
  });
  scene.arrow(pub[1], caSub, {
    color: C.violet,
    strokeStyle: 'dashed',
    strokeWidth: 3,
    label: 'Entra token issuance · managed identity · app roles\n(identity plane, not a data plane)',
    labelWidth: 640,
    labelAt: { x: pub[1].cx + 120, y: gapBandY },
    sides: ['bottom', 'top'],
  });
  scene.arrow(caSub, peSub, {
    color: C.green,
    strokeWidth: 5,
    sides: ['right', 'left'],
    label: 'ALL data-plane\ntraffic leaves\nthrough a private\nendpoint',
    labelWidth: 200,
    labelDy: -110,
  });
  scene.arrow(router, peSub, {
    color: C.blue,
    strokeWidth: 4,
    sides: ['right', 'left'],
    label: 'only the router\nreaches a model\ndeployment',
    labelWidth: 200,
    labelDy: 90,
  });
  scene.arrow(peSub, dpGroup, {
    color: C.green,
    strokeWidth: 5,
    sides: ['bottom', 'top'],
    label:
      'five private endpoints, six private DNS zones linked to the VNet —\neach terminates on the data plane below',
    labelWidth: 760,
    labelAt: { x: caSubX + 420, y: vContentTop + subnetRowH + 34 },
  });
  scene.arrow(webui, router, { color: C.blue, strokeWidth: 3, sides: ['bottom', 'top'] });
  for (const lane of lanes) {
    scene.arrow(lane, router, { color: C.green, strokeWidth: 2, sides: ['top', 'bottom'] });
  }

  // ---- legend ------------------------------------------------------------
  scene.legend({
    x: X0,
    y: vnetY + vnetH + 60,
    width: 1240,
    items: [LEGEND_PRIVATE, LEGEND_PUBLIC, LEGEND_PREVIEW, LEGEND_CHOKEPOINT, LEGEND_ABSENT],
  });
  scene.box({
    x: X0 + 1240 + 60,
    y: vnetY + vnetH + 60,
    width: W - 1240 - 60,
    title: 'What Beat 2 demonstrates with this picture',
    body:
      'task cloud:prove-private attempts the same data-plane operation from outside and from inside the VNet: the first fails, the second succeeds.\nThe CI policy job then shows that it cannot silently stop being private. The claim is continuous, not a point-in-time configuration.\nDeliberately excluded (say so out loud): no high availability, no disaster recovery, no multi-region, no real execution, no real data.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

// ===========================================================================
// 02 — Request decision flow
// ===========================================================================

export function requestDecisionFlow() {
  const scene = new Scene({ name: '02-request-decision-flow', seed: 0x22c4d5e6 });
  const X0 = 80;
  const W = 2960;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '02 · POST /v1/route — how a request becomes a governed decision',
    subtitle:
      'Conclusion: the caller never names a model, and governance policy runs BEFORE cost and complexity selection — so a cost optimisation can never reach a model policy has not approved.',
  });

  // Three columns with 200px gutters, so an arrow label never lands on a box.
  const COL_L = { x: X0, width: 760 };
  const COL_C = { x: X0 + 760 + 200, width: 1000 };
  const COL_R = { x: X0 + 760 + 200 + 1000 + 200, width: 800 };

  const topY = 230;

  // ---- Left column: the caller ------------------------------------------
  const callerSpec = {
    title: 'Caller  ·  lane service or webui',
    body:
      'POST /v1/route   (Entra token, Router.Invoke app role)\n{\n  "correlationId": "b6b1f0a2-…",\n  "lane": "Research",\n  "taskKind": "synthesize",\n  "payload": { "question": "…" },\n  "costCeilingUsd": 0.25,\n  "latencyBudgetMs": 8000,\n  "dataClassification": "Internal",\n  "policySetId": "CapitalMarkets-US",\n  "complexityHints": {\n    "inputTokenEstimate": 12000,\n    "requiresMultiStep": true,\n    "requiresRetrieval": true,\n    "requiresToolCalls": false\n  }\n}',
    bodyFamily: MONO,
    bodySize: 16,
    stroke: C.blue,
    background: C.white,
  };
  const caller = scene.box({ ...callerSpec, x: COL_L.x, y: topY, width: COL_L.width });

  const absent = scene.box({
    x: COL_L.x,
    y: caller.y + caller.height + 50,
    width: COL_L.width,
    title: 'PRINCIPLE IV — what is NOT in this request',
    body:
      'There is no "model" field.\nThere is no "vendor" field.\nThere is no "deployment" field.\n\nAnd there will not be one: a field that exists is a field that\neventually gets used. dataClassification states what the data IS;\nit is not a routing preference. Omitting it is a 400, never an\nassumption of "Public".',
    stroke: C.red,
    background: C.bgRed,
    strokeWidth: 4,
  });

  const orderBanner = scene.box({
    x: COL_L.x,
    y: absent.y + absent.height + 50,
    width: COL_L.width,
    title: 'THE ORDER IS LOAD-BEARING',
    body:
      'catalog → PolicyGate.Evaluate() → eligible → TierSelector.Select()\n\nPolicy decides what is PERMISSIBLE.\nThe router then decides what is APPROPRIATE among the permissible.\n\nReverse these two and a cost optimisation can reach a model\ngovernance has not approved. The order is asserted by test, not\nleft to code reading.',
    stroke: C.red,
    background: C.bgYellow,
    strokeWidth: 4,
  });

  const swap = scene.box({
    x: COL_L.x,
    y: orderBanner.y + orderBanner.height + 50,
    width: COL_L.width,
    title: 'Beat 5 — the swap nobody deployed for',
    body:
      'An approver toggles Anthropic off on /policy. No redeploy, no code\nchange, no prompt change. The identical request replans across the\nremaining approved vendors and the exclusion reason reads:\n"Vendor Anthropic is not approved under policy set\n\'CapitalMarkets-US\'."\n\nSet dataClassification to Restricted and every hosted vendor is\nexcluded; execution lands on the open-weight model on managed\ncompute inside the VNet.',
    stroke: C.violet,
    background: C.bgViolet,
  });

  // ---- Centre column: the pipeline ---------------------------------------
  const steps = [
    {
      title: 'router-service  ·  POST /v1/route',
      body:
        'Internal Container Apps ingress. There is no public FQDN.\nRejects a caller without the Router.Invoke app role with 403.\nRoutingPlanner.Plan() is the single entry point and the one place\nthe evaluation order is decided — calling TierSelector directly\nwould bypass the gate.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 3,
    },
    {
      title: 'ComplexityScorer.Score(hints)',
      body:
        'Pure, deterministic, caller-supplied signals only — never inferred from model output.\ntokens/32000 × 0.40  +  multiStep × 0.25  +  retrieval × 0.20  +  toolCalls × 0.15\nRounded to 4dp, clamped 0–1.   IndicatedTier:  <0.35 Economy · <0.70 Standard · else Premium.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: 'STEP 1 — PolicyGate.Evaluate(catalog, policySet, classification, region)',
      body:
        'Runs FIRST, against the full multi-vendor catalog. Excludes, in order:\n  · region not in policy.AllowedRegions  → the whole catalog is excluded\n  · vendor not in policy.ApprovedVendors\n  · classification > policy.MaxClassification[vendor]\n  · cost > policy.MaxCostPerRequestUsd\nEvery exclusion carries prose fit to read aloud to a governance audience.',
      stroke: C.red,
      background: C.bgYellow,
      strokeWidth: 4,
    },
    {
      title: 'STEP 2 — TierSelector.Select(score, ceiling, eligible)',
      body:
        'Sees ONLY the policy-eligible candidates. Prefers the indicated tier; if it is\nunaffordable or unavailable it takes the most capable tier that is both.\nThe ceiling is a control, not a report.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 4,
    },
    {
      title: 'Vendor invocation',
      body:
        'The selected deployment is invoked over the Foundry private endpoint.\nAPIM metering / content safety is specified but not yet in Terraform.\nNo silent retry on a different tier — that would corrupt the cost figures.',
      stroke: C.green,
      background: C.bgGreen,
    },
  ];

  const centreBoxes = [];
  let cy = topY;
  for (const spec of steps) {
    const b = scene.box({ ...spec, x: COL_C.x, y: cy, width: COL_C.width });
    centreBoxes.push(b);
    cy = b.y + b.height + 60;
  }
  const [entry, scorer, gate, selector, invoke] = centreBoxes;

  // ---- Right column: the four outcomes ------------------------------------
  const outcomes = [
    {
      title: 'RefusedByPolicy  →  HTTP 200',
      body:
        'Policy left no eligible candidate. selectedDeployment is null and every\ncandidate is listed with its reason.\n\nReturned as 200 on purpose: a refusal is a correct, governed outcome.\nModelling it as 4xx would invite retry-on-error, and the one thing that\nmust never happen is a retry that finds an unapproved model.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 4,
    },
    {
      title: 'Denied  →  HTTP 402',
      body:
        'Cost ceiling. Even the cheapest available tier projects above the ceiling.\n"Cheapest available tier Economy projects 0.310 USD against a ceiling\nof 0.250 USD."\n\nKept distinct from RefusedByPolicy: "too expensive" and "not permitted"\nare different conversations with different people.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 3,
    },
    {
      title: 'Downgraded  →  HTTP 200',
      body:
        'Complexity indicated a higher tier; the ceiling did not allow it.\nRouted to the most capable affordable tier, with the downgrade named\nin the rationale. This is wow moment B on the comparison screen.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 3,
    },
    {
      title: 'Routed  →  HTTP 200',
      body:
        'Routed to the tier the complexity score indicated, within both the policy\nceiling and the request ceiling. Rationale names the deciding factor in a\nplain sentence, because the presenter reads it aloud on stage.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
  ];
  const outcomeH = outcomes.map((s2) => Scene.measure(s2, COL_R.width - 60));
  const outcomesTop = topY;
  const outcomesGroupH = 96 + outcomeH.reduce((a, b) => a + b + 50, 0) - 50 + 30;
  const outcomesGroup = scene.group({
    x: COL_R.x - 30,
    y: outcomesTop,
    width: COL_R.width,
    height: outcomesGroupH,
    label: 'FOUR OUTCOMES — three of them are HTTP 200',
    sublabel: 'A governed "no" is a correct answer, not an error.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  const outcomeBoxes = [];
  let oy = outcomesTop + 96;
  outcomes.forEach((spec, i) => {
    const b = scene.box({ ...spec, x: COL_R.x, y: oy, width: COL_R.width - 60, height: outcomeH[i] });
    outcomeBoxes.push(b);
    oy = b.y + b.height + 50;
  });
  oy = outcomesTop + outcomesGroupH;
  const [refused, denied, downgraded, routed] = outcomeBoxes;

  // ---- Bottom: persistence + audit ---------------------------------------
  const bottomY = Math.max(cy, oy, swap.y + swap.height + 60) + 40;
  const persistCols = columns({ x: X0 + 40, count: 3, width: (W - 80 - 2 * 40) / 3, gap: 40 });
  const persistItems = [
    {
      title: 'Cosmos  ·  routerDecisions',
      body:
        'Partitioned by /correlationId.\nInputs, candidate tiers with per-candidate rejection\nreasons, policy exclusions, outcome, rationale,\npolicySetId and policySetVersion.\nGET /v1/decisions/{correlationId} (Router.Read).',
      stroke: C.green,
      background: C.bgGreen,
    },
    {
      title: 'Cosmos  ·  auditEvents  (append-only)',
      body:
        'Every step writes one record keyed by the same correlationId.\nAppend-only and retained for the life of the environment.\nAC-8: the whole chain is reconstructable in ONE query —\nwhich is exactly what Beat 8 does from an unrehearsed pick.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
    {
      title: 'Scoreboard  ·  Application Insights (Cosmos change feed as fallback)',
      body:
        'GET /v1/scoreboard?window=15m — count, total cost, baseline cost,\nsavings delta, p50/p95 latency, tier distribution, mean quality by lane.\nVisible within 5 seconds (AC-5). Sampling is disabled for router and\napproval telemetry; the UI labels the degraded source when it falls back.',
      stroke: C.blue,
      background: C.bgBlue,
    },
  ];
  const persistH = rowHeight(persistItems, persistCols.at(0).width);
  const persistGroup = scene.group({
    x: X0,
    y: bottomY,
    width: W,
    height: 82 + persistH + 30,
    label: 'EVERY outcome above — including both refusals — is persisted and audited',
    sublabel:
      'A denial is never silently absorbed; it is always surfaced to the UI. Principle VI: one correlationId spans the whole lifecycle.',
    stroke: C.green,
    background: C.white,
    strokeWidth: 3,
  });
  placeRow(scene, persistCols, bottomY + 82, persistItems);

  // ---- arrows ------------------------------------------------------------
  scene.arrow(caller, entry, {
    color: C.blue,
    strokeWidth: 3,
    label: 'a business\nrequest, not a\nmodel choice',
    labelWidth: 190,
    labelDy: -60,
  });
  scene.arrow(entry, scorer, { color: C.ink, strokeWidth: 3, sides: ['bottom', 'top'] });
  scene.arrow(scorer, gate, {
    color: C.red,
    strokeWidth: 5,
    sides: ['bottom', 'top'],
    label: 'score + the FULL catalog',
    labelWidth: 300,
    labelDx: 260,
  });
  scene.arrow(gate, selector, {
    color: C.red,
    strokeWidth: 5,
    sides: ['bottom', 'top'],
    label: 'ONLY the policy-eligible candidates reach selection',
    labelWidth: 460,
    labelDx: 340,
  });
  scene.arrow(selector, invoke, { color: C.green, strokeWidth: 3, sides: ['bottom', 'top'] });

  scene.arrow(gate, refused, {
    color: C.red,
    strokeWidth: 4,
    sides: ['right', 'left'],
    label: 'no eligible\ncandidate',
    labelWidth: 190,
    labelDy: -46,
  });
  scene.arrow(selector, denied, {
    color: C.red,
    strokeWidth: 3,
    sides: ['right', 'left'],
    label: 'nothing\naffordable',
    labelWidth: 190,
    labelDy: -46,
  });
  scene.arrow(invoke, downgraded, {
    color: C.orange,
    strokeWidth: 3,
    sides: ['right', 'left'],
    label: 'chosen.Tier\n< indicated',
    labelWidth: 190,
    labelDy: -46,
  });
  scene.arrow(invoke, routed, {
    color: C.green,
    strokeWidth: 3,
    sides: ['right', 'left'],
    label: 'chosen.Tier\n== indicated',
    labelWidth: 190,
    labelDy: 46,
  });

  scene.arrow(invoke, persistGroup, {
    color: C.green,
    strokeWidth: 4,
    sides: ['bottom', 'top'],
    label: 'result + metrics',
    labelWidth: 260,
    labelDx: -190,
  });
  scene.arrow(outcomesGroup, persistGroup, {
    color: C.ink,
    strokeWidth: 4,
    sides: ['bottom', 'top'],
    elbow: 'v',
    label: 'EVERY outcome is written,\nincluding both refusals',
    labelWidth: 400,
    labelDx: -230,
    labelDy: 60,
  });

  // ---- legend ------------------------------------------------------------
  const legendY = bottomY + 82 + persistH + 30 + 60;
  scene.legend({
    x: X0,
    y: legendY,
    width: 1240,
    items: [
      LEGEND_CHOKEPOINT,
      { stroke: C.red, background: C.bgYellow, text: 'Governance gate. Runs before any cost reasoning.' },
      LEGEND_PUBLIC,
      { stroke: C.orange, background: C.bgYellow, text: 'Cost control acting — a downgrade, visible and explained.' },
      LEGEND_PRIVATE,
    ],
  });
  scene.box({
    x: X0 + 1240 + 60,
    y: legendY,
    width: W - 1240 - 60,
    title: 'The test of Principle IV, stated as an experiment',
    body:
      'Two requests with byte-identical bodies, submitted under different policy sets, may execute on different vendors and both succeed.\nIf swapping a vendor requires a code change, a redeploy, or a prompt edit, the principle is violated — no matter what the diagram says.\nThe router is deterministic code and always will be: routing the thing that decides routing would be circular, and a compliance audience\nwill read this assembly line by line. It is under a 70% coverage gate for exactly that reason.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

// ===========================================================================
// 03 — Agent architecture
// ===========================================================================

export function agentArchitecture() {
  const scene = new Scene({ name: '03-agent-architecture', seed: 0x33e6f708 });
  const X0 = 80;
  const W = 2760;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '03 · Lane services as custodians of Foundry hosted agents',
    subtitle:
      'Conclusion: the agent reasons but the service is accountable — two network-enforced boundaries stop the agent reaching a model or a tool reaching a model, and no consequential action leaves the system without a human.',
  });

  const topY = 240;
  const cols4 = columns({ x: X0, count: 4, width: (W - 3 * 160) / 4, gap: 160 });

  const custodianSpec = {
    title: '① Lane service  ·  the CUSTODIAN',
    body:
      'C# on Container Apps. It is not the agent.\n\n1. stamps correlationId BEFORE thread creation\n2. creates ONE thread for ONE business request —\n   threads are never reused, because carried-over\n   context makes cost and reproducibility\n   unexplainable and both are demo claims\n3. supplies the tool surface\n4. enforces the approval halt\n5. writes the audit record\n\nStep budget: exceed it and the agent halts, returns\npartial work, and logs. An agent that loops on stage\nis worse than one that stops.',
    stroke: C.blue,
    background: C.bgBlue,
    strokeWidth: 3,
  };
  const agentSpec = {
    title: '② Hosted Foundry agent  ·  one per lane',
    body:
      'Runs under the Foundry PROJECT identity (ADR 005).\n\nResearch — retrieve, then synthesise per claim.\n  Read-only. Must be able to return "I could not\n  attribute this" as a SUCCESS (Principle III).\nSurveillance — triage 500+ alerts, then assemble\n  evidence. Halts for approval.\nOrder routing — one proposal. Halts every time.\n\nRetrieved chunks are DATA, never instructions:\nwrapped in a delimited envelope that carries no tool\nauthority. Injection attempts are logged as audit\nevents (T-024).',
    stroke: C.violet,
    background: C.bgViolet,
    strokeWidth: 3,
  };
  const mcpSpec = {
    title: '③ MCP tool server  ·  hosted IN the lane service',
    body:
      'Research: search_corpus, fetch_chunk, list_sources\n  — all read-only.\nSurveillance: fetch_alert_batch, fetch_communications,\n  fetch_trade_context, submit_for_approval.\nOrder routing: fetch_order, fetch_venue_liquidity,\n  evaluate_best_execution_policy, submit_for_approval.\n\nevaluate_best_execution_policy is deterministic code\nthe agent CALLS, not the agent\'s judgement. The model\nexplains the result; code decides what is permitted.\n\nsubmit_for_approval is the ONLY tool in the entire\nsystem with a side effect — and it writes a proposal,\nnever a state change.',
    stroke: C.green,
    background: C.bgGreen,
    strokeWidth: 3,
  };
  const dataSpec = {
    title: '④ Data planes  ·  private endpoints only',
    body:
      'Azure AI Search — synthetic research corpus.\nCosmos DB — alerts, proposals, approvals, audit.\nSimulated OMS — labelled simulated on the record\nitself, not as a disclaimer in a corner, so a\nscreenshot taken out of context is still honest.\n\nThe lane service identities hold Search Index Data\nReader and nothing on Foundry (apps/roles.tf).',
    stroke: C.green,
    background: C.bgGreen,
    strokeWidth: 3,
  };

  const rowSpecs = [custodianSpec, agentSpec, mcpSpec, dataSpec];
  const rowH = rowHeight(rowSpecs, cols4.at(0).width);
  const rowBoxes = rowSpecs.map((s, i) =>
    scene.box({ ...s, x: cols4.at(i).x, y: topY, width: cols4.at(i).width, height: rowH }),
  );
  const [custodian, agent, mcp, dataPlanes] = rowBoxes;

  scene.arrow(custodian, agent, {
    color: C.blue,
    strokeWidth: 3,
    label: 'thread +\ncorrelationId',
    labelWidth: 150,
    labelDy: -60,
  });
  scene.arrow(agent, mcp, {
    color: C.violet,
    strokeWidth: 3,
    label: 'tool call',
    labelWidth: 150,
    labelDy: -60,
  });
  scene.arrow(mcp, dataPlanes, {
    color: C.green,
    strokeWidth: 3,
    label: 'reads data',
    labelWidth: 150,
    labelDy: -60,
  });

  // ---- Boundary 2 --------------------------------------------------------
  const b2y = topY + rowH + 70;
  const b2 = scene.box({
    x: X0,
    y: b2y,
    width: W,
    title: 'BOUNDARY 2 — network enforced:  TOOLS REACH DATA, NEVER MODELS',
    body:
      'No MCP tool wraps a model invocation. If a tool needs model output it calls the router like any other caller, and that call is routed, priced and recorded.\nThis is what keeps the cost scoreboard a total rather than a sample: there is no side door through which an unmetered model call can be made.',
    stroke: C.red,
    background: C.bgRed,
    strokeWidth: 4,
    strokeStyle: 'dashed',
  });

  // ---- Boundary 1 --------------------------------------------------------
  const b1y = b2.y + b2.height + 60;
  const b1 = scene.box({
    x: X0,
    y: b1y,
    width: W,
    title: "BOUNDARY 1 — network enforced:  THE AGENT'S MODEL ACCESS IS THE ROUTER'S",
    body:
      'Only the router-service identity holds "Azure AI Developer" on the Foundry project (apps/roles.tf). The lane services have no such assignment and no route to the Foundry data plane.\nThis is not a convention enforced by code review. It is the reason the cost ceiling is a control rather than a reporting feature: a ceiling services could bypass would be advisory.',
    stroke: C.red,
    background: C.bgRed,
    strokeWidth: 4,
    strokeStyle: 'dashed',
  });

  // ---- Router chain ------------------------------------------------------
  const chainY = b1.y + b1.height + 60;
  const chainCols = columns({ x: X0, count: 3, width: (W - 2 * 60) / 3, gap: 60 });
  const chainSpecs = [
    {
      title: 'router-service  ·  POST /v1/route',
      body:
        'The single chokepoint. Deterministic code, never an agent:\nmaking the component that enforces governance non-deterministic\nis not a position you can defend to a compliance audience.\nPolicyGate then TierSelector, decision recorded with rationale.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 4,
    },
    {
      title: 'APIM AI gateway  —  NOT IN TERRAFORM',
      body:
        'Specified for token metering, cost ceilings and content safety in\ndocs/architecture.md and the constitution. No APIM resource exists\nin either stack today, so the ceiling is currently enforced in one\nplace (the router) rather than two.',
      stroke: C.red,
      background: C.white,
      strokeWidth: 3,
      strokeStyle: 'dashed',
    },
    {
      title: 'Foundry model deployments',
      body:
        'Serverless: AzureOpenAI, Anthropic, xAI.\nManaged compute (PREVIEW): open-weight model on H100_80GB\ncapacity inside the VNet — the only destination cleared for\nRestricted data.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
  ];
  const chainH = rowHeight(chainSpecs, chainCols.at(0).width);
  const chain = chainSpecs.map((s, i) =>
    scene.box({ ...s, x: chainCols.at(i).x, y: chainY, width: chainCols.at(i).width, height: chainH }),
  );
  scene.arrow(chain[0], chain[1], { color: C.blue, strokeWidth: 3 });
  scene.arrow(chain[1], chain[2], { color: C.green, strokeWidth: 3 });
  scene.arrow(agent, b1, {
    color: C.violet,
    strokeWidth: 3,
    strokeStyle: 'dashed',
    sides: ['bottom', 'top'],
    label: 'model invocation — crosses the boundary only via the router',
    labelWidth: 620,
    labelAt: { x: X0 + W - 420, y: b2.y + b2.height + 30 },
  });
  scene.arrow(b1, chain[0], { color: C.red, strokeWidth: 4, sides: ['bottom', 'top'] });

  // ---- Determinism row ---------------------------------------------------
  const detY = chainY + chainH + 70;
  const detCols = columns({ x: X0 + 40, count: 3, width: (W - 80 - 2 * 60) / 3, gap: 60 });
  const detSpecs = [
    {
      title: 'The model produces SCORES',
      body:
        'Each alert is scored against a fixed rubric with the temperature\npinned. 500 alerts do not fit one context window and do not try to:\nthe service chunks them and routes each chunk independently —\nwhich is also what makes the cost scoreboard interesting.',
      stroke: C.violet,
      background: C.bgViolet,
    },
    {
      title: 'Deterministic CODE produces the RANKING',
      body:
        'The ordering is applied by the lane service, not by the model.\nThis is the single design choice that makes AC-6 achievable:\nsame seed and same inputs produce the same order, provably,\non stage. A free-running agent over 500 alerts would not.',
      stroke: C.blue,
      background: C.bgBlue,
      strokeWidth: 4,
    },
    {
      title: 'Quality is deterministic too — never LLM-as-judge',
      body:
        'Attribution coverage (research), rank agreement against a seeded\nground truth (surveillance), policy conformance (order routing).\nAll recomputable by the audience. A model-graded number invites\nan obvious objection and the demo loses the room defending it.',
      stroke: C.green,
      background: C.bgGreen,
    },
  ];
  const detH = rowHeight(detSpecs, detCols.at(0).width);
  scene.group({
    x: X0,
    y: detY,
    width: W,
    height: 82 + detH + 30,
    label: 'REPRODUCIBILITY — where the model stops and code starts',
    sublabel: 'The boundary that makes AC-6 (identical ranking for a fixed seed) an achievable claim.',
    stroke: C.blue,
    background: C.white,
    strokeWidth: 3,
  });
  const detBoxes = detSpecs.map((s, i) =>
    scene.box({ ...s, x: detCols.at(i).x, y: detY + 82, width: detCols.at(i).width, height: detH }),
  );
  scene.arrow(detBoxes[0], detBoxes[1], { color: C.blue, strokeWidth: 3 });
  scene.arrow(detBoxes[1], detBoxes[2], { color: C.green, strokeWidth: 3 });

  // ---- Human in the loop -------------------------------------------------
  const hitlY = detY + 82 + detH + 30 + 70;
  const hitlCols = columns({ x: X0 + 40, count: 4, width: (W - 80 - 3 * 50) / 4, gap: 50 });
  const hitlSpecs = [
    {
      title: 'submit_for_approval',
      body:
        'The only side-effecting tool in the system.\nIt writes a proposal plus an evidence packet.\nNo alert, order or publication changes state.',
      stroke: C.orange,
      background: C.bgYellow,
    },
    {
      title: 'PendingApproval  ·  Cosmos approvals',
      body:
        'The proposal, the evidence packet exactly as it\nwill be presented, and the proposing identity.\nPartitioned by /correlationId.',
      stroke: C.orange,
      background: C.bgYellow,
    },
    {
      title: 'HUMAN approver  ·  Approver app role',
      body:
        'Segregation of duties is enforced in the approval API,\nnot in the UI. The UI renders the control disabled with\nthe reason; the API refuses the call. Beat 6 shows the\nAPI refusing, because that is the one the audience believes.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 4,
    },
    {
      title: 'Approved → executed & audited   ·   Expired → nothing happened',
      body:
        'An approval persists approver identity, timestamp, decision and\nthe full evidence packet presented at decision time.\nAn unapproved proposal EXPIRES. It never auto-executes on\ntimeout — a gate that opens on inaction is not a gate.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 3,
    },
  ];
  const hitlH = rowHeight(hitlSpecs, hitlCols.at(0).width);
  scene.group({
    x: X0,
    y: hitlY,
    width: W,
    height: 82 + hitlH + 30,
    label: 'PRINCIPLE I — HUMAN IN THE LOOP (NON-NEGOTIABLE)',
    sublabel: 'The agent may propose, rank, draft and evidence. It may not commit.',
    stroke: C.orange,
    background: C.white,
    strokeWidth: 4,
  });
  const hitlBoxes = hitlSpecs.map((s, i) =>
    scene.box({ ...s, x: hitlCols.at(i).x, y: hitlY + 82, width: hitlCols.at(i).width, height: hitlH }),
  );
  scene.arrow(hitlBoxes[0], hitlBoxes[1], { color: C.orange, strokeWidth: 3 });
  scene.arrow(hitlBoxes[1], hitlBoxes[2], { color: C.orange, strokeWidth: 3 });
  scene.arrow(hitlBoxes[2], hitlBoxes[3], { color: C.orange, strokeWidth: 3 });

  // ---- Failure modes -----------------------------------------------------
  const failY = hitlY + 82 + hitlH + 30 + 70;
  const failCols = columns({ x: X0 + 40, count: 4, width: (W - 80 - 3 * 50) / 4, gap: 50 });
  const failSpecs = [
    {
      title: 'Tool error',
      body: 'Surfaced to the agent. One retry, then partial\nresults with the gap explicitly named.',
    },
    {
      title: 'Model timeout',
      body:
        'The router returns a routing failure and the lane\nreports it. NO silent retry on a different tier —\nthat would corrupt the cost figures.',
    },
    {
      title: 'No eligible model (policy)',
      body:
        'Explicit refusal naming the exclusions. Never a\nfallback to an unapproved model. A governance\nsystem that degrades OPEN is not a control.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 3,
    },
    {
      title: 'Step budget exceeded',
      body:
        'Halt, return partial work, log. Foundry caps tool\ncount and step depth; the surveillance agent is\nclosest to those limits (verify early, T-027a).',
    },
  ];
  const failH = rowHeight(failSpecs, failCols.at(0).width);
  scene.group({
    x: X0,
    y: failY,
    width: W,
    height: 82 + failH + 30,
    label: 'FAILURE MODES — each has a defined, demonstrable behaviour',
    sublabel: 'Every one of these is rehearsed. A failure with no defined behaviour is a failure discovered on stage.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  failSpecs.forEach((s, i) =>
    scene.box({
      stroke: C.ink,
      background: C.white,
      ...s,
      x: failCols.at(i).x,
      y: failY + 82,
      width: failCols.at(i).width,
      height: failH,
    }),
  );

  // ---- legend ------------------------------------------------------------
  const legendY = failY + 82 + failH + 30 + 60;
  scene.legend({
    x: X0,
    y: legendY,
    width: 1240,
    items: [
      LEGEND_CHOKEPOINT,
      { stroke: C.violet, background: C.bgViolet, text: 'Model reasoning — the non-deterministic part, deliberately fenced.' },
      LEGEND_PRIVATE,
      LEGEND_HUMAN,
      { stroke: C.red, background: C.bgRed, strokeStyle: 'dashed', text: 'Network-enforced boundary, or a refusal path.' },
      LEGEND_ABSENT,
    ],
  });
  scene.box({
    x: X0 + 1240 + 60,
    y: legendY,
    width: W - 1240 - 60,
    title: 'Why the router is not an agent',
    body:
      'The exchange is deterministic code: policy evaluation, complexity scoring, tier selection. It is the component a compliance audience will interrogate line by line\nand the assembly under a coverage gate. Making it an agent would mean explaining why the thing that enforces governance is itself non-deterministic.\nIt is a service, permanently. The same separation appears twice more: evaluate_best_execution_policy decides and the agent explains; the model scores alerts\nand the service ranks them. In each case the model reasons and code decides what is permitted.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

// ===========================================================================
// 04 — UI screen map
// ===========================================================================

export function uiScreenMap() {
  const scene = new Scene({ name: '04-ui-screen-map', seed: 0x44081920 });
  const X0 = 80;
  const W = 2520;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '04 · Scoreboard UI — twelve screens, grouped by app role',
    subtitle:
      'Conclusion: for the audience the UI is the system, and every beat of the demo has a screen that owns it — including the governance surface (/policy) that Beat 5 cannot happen without.',
  });

  const topY = 240;
  const roleCols = columns({ x: X0, count: 3, width: (W - 2 * 160) / 3, gap: 160 });
  const colW = roleCols.at(0).width;
  const innerW = colW - 60;

  const invokeScreens = [
    {
      title: '1 · Request console   /',
      body:
        'Beats 3 and 5. T-028.\nSubmits a business request: intent, cost ceiling,\ndata classification. Exposes classification as a\ncontrol — it is a property of the REQUEST, not a\nrouting preference, so it stays inside Principle IV.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '9 · Research   /research   — WOW D',
      body:
        'Beat 7. T-033.\nInline citations as clickable superscripts opening the\nsource chunk; coverage percentage in the header.\nThe unattributable-claims panel is ALWAYS present and\nsays "no unattributable claims" when empty — a panel\nthat only appears on failure teaches the audience it is\nan error state rather than a control.',
      stroke: C.violet,
      background: C.bgViolet,
      strokeWidth: 4,
    },
    {
      title: '10 · Order routing   /orders',
      body:
        'No beat of its own. T-034.\nEvery surface showing execution is labelled SIMULATED\non the record itself, not as a corner disclaimer.',
      stroke: C.blue,
      background: C.bgBlue,
    },
  ];

  const readScreens = [
    {
      title: '2 · Live scoreboard   /scoreboard',
      body:
        'Beat 3. T-029.\n5-second refresh; shows the timestamp of the data,\nnot a spinner. A stale number that admits it is stale\nbeats a fresh-looking lie.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '3 · Cost comparison   /scoreboard/comparison   — WOW B',
      body:
        'Beat 3. T-030.\nONE number dominates: percentage saved against an\nall-premium baseline. Per-request tier, cost, latency\nand rationale beneath it. The presenter drills a row\nmid-sentence and reads the rationale aloud, so the\nrationale must be a plain sentence naming the deciding\nfactor — not a JSON blob and not a score.',
      stroke: C.violet,
      background: C.bgViolet,
      strokeWidth: 4,
    },
    {
      title: '4 · Decision detail   /decisions/:id',
      body:
        'Beats 3 and 8. T-029.\nComplexity inputs, candidate tiers with per-candidate\nrejection reasons, policy exclusions, outcome, rationale.\nEvery number on the scoreboard opens to this.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '5 · Surveillance triage   /surveillance   — WOW C',
      body:
        'Beat 4. T-031.\n500+ alerts, virtualised list (500 DOM rows stutter on\nprojector hardware and the stutter reads as "this does\nnot scale"). Sorts default to model rank, because the\nranking IS the product. A visible seed indicator carries\nthe AC-6 reproducibility claim.',
      stroke: C.violet,
      background: C.bgViolet,
      strokeWidth: 4,
    },
    {
      title: '6 · Alert detail   /surveillance/:id',
      body:
        'Beat 4. T-031.\nRationale plus assembled evidence. Proposing escalation\nfrom here creates an approval, never an escalation.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: '11 · Audit reconstruction   /audit/:correlationId',
      body:
        'Beat 8. T-020.\nOne query rebuilds the whole chain. The audience picks\nthe interaction — unrehearsed, or it is worth nothing.',
      stroke: C.green,
      background: C.bgGreen,
      strokeWidth: 3,
    },
  ];

  const approverScreens = [
    {
      title: '7 · Approval queue   /approvals',
      body:
        'Beat 6. T-032.\nPending proposals with their evidence packets, and\nexpired proposals showing that a timeout produced\nno action at all.',
      stroke: C.orange,
      background: C.bgYellow,
    },
    {
      title: '8 · Approval detail   /approvals/:id',
      body:
        'Beat 6. T-032.\nThe approve control renders DISABLED with the reason\nstated when the viewer is the proposer — and the API\nrefuses the call independently. Unauthorised navigation\nis hidden; unauthorised ACTIONS are visibly blocked.\nThose are different on purpose: a hidden button leaves\nnothing to demonstrate.',
      stroke: C.orange,
      background: C.bgYellow,
      strokeWidth: 4,
    },
    {
      title: '12 · Policy sets   /policy   — UNSCHEDULED',
      body:
        'Beat 5. No task number: this screen does not exist in\nthe current task list, and Beat 5 cannot run without it.\nThe vendor toggle has to live in the product — doing it\nin the Azure portal breaks the claim that governance is\na first-class surface. Read-mostly with a single vendor\ntoggle is enough.',
      stroke: C.red,
      background: C.bgRed,
      strokeWidth: 4,
    },
  ];

  function placeColumn(index, roleTitle, roleSub, screens, stroke) {
    const x = roleCols.at(index).x;
    const heights = screens.map((s) => Scene.measure(s, innerW));
    const groupH = 96 + heights.reduce((a, b) => a + b + 40, 0) - 40 + 30;
    const g = scene.group({
      x,
      y: topY,
      width: colW,
      height: groupH,
      label: roleTitle,
      sublabel: roleSub,
      stroke,
      background: C.white,
      strokeWidth: 3,
    });
    let y = topY + 96;
    const boxes = screens.map((s, i) => {
      const b = scene.box({ ...s, x: x + 30, y, width: innerW, height: heights[i] });
      y += heights[i] + 40;
      return b;
    });
    return { boxes, bottom: topY + groupH, group: g };
  }

  const invoke = placeColumn(
    0,
    'Router.Invoke',
    'Service-to-service model access through the router. Application member type.',
    invokeScreens,
    C.blue,
  );
  const read = placeColumn(
    1,
    'Router.Read',
    'Read routing decisions and the scoreboard. User and Application.',
    readScreens,
    C.blue,
  );
  const approver = placeColumn(
    2,
    'Approver',
    'Decide on pending proposals. Cannot approve own proposals. User only.',
    approverScreens,
    C.orange,
  );

  const bottom = Math.max(invoke.bottom, read.bottom, approver.bottom);

  // Navigation / drill paths that the demo actually walks.
  scene.arrow(read.boxes[1], read.boxes[2], {
    color: C.blue,
    strokeWidth: 3,
    sides: ['left', 'left'],
    elbow: 'h',
    label: 'drill a row\nmid-sentence',
    labelWidth: 140,
    labelDx: -80,
  });
  scene.arrow(read.boxes[3], read.boxes[4], {
    color: C.blue,
    strokeWidth: 3,
    sides: ['left', 'left'],
    elbow: 'h',
    label: 'open the\ntop alert',
    labelWidth: 140,
    labelDx: -80,
  });
  scene.arrow(read.boxes[4], approver.boxes[0], {
    color: C.orange,
    strokeWidth: 4,
    label: 'propose\nescalation →\nit does NOT\nescalate',
    labelWidth: 150,
  });
  scene.arrow(approver.boxes[0], approver.boxes[1], {
    color: C.orange,
    strokeWidth: 3,
    sides: ['right', 'right'],
    elbow: 'h',
    label: 'open the\nevidence packet',
    labelWidth: 140,
    labelDx: 80,
  });
  const beat5Detour =
    bottom - (approver.boxes[2].y + approver.boxes[2].height) + 70;
  scene.arrow(approver.boxes[2], invoke.group, {
    color: C.red,
    strokeWidth: 5,
    sides: ['bottom', 'bottom'],
    detour: beat5Detour,
    label:
      'BEAT 5: disable a vendor on 12 · Policy sets, then resubmit the IDENTICAL request on 1 · Request console.  No redeploy, no code change, no prompt change.',
    labelWidth: 1100,
    labelAt: { x: X0 + W / 2, y: bottom + 100 },
  });
  scene.arrow(read.boxes[2], read.boxes[5], {
    color: C.green,
    strokeWidth: 3,
    sides: ['right', 'right'],
    elbow: 'h',
    label: 'correlationId',
    labelWidth: 140,
    labelDx: 80,
  });

  // ---- Beat track --------------------------------------------------------
  const beatY = bottom + 170;
  const beatCols = columns({ x: X0 + 40, count: 6, width: (W - 80 - 5 * 40) / 6, gap: 40 });
  const beats = [
    { title: 'Beat 2', body: 'Private by construction.\nNo screen — it is a shell\nand a CI job.' },
    { title: 'Beat 3 — PRIMARY', body: 'Router economics.\nScreens 1, 2, 3, 4.', stroke: C.violet, background: C.bgViolet },
    { title: 'Beat 4 — PRIMARY', body: 'Surveillance triage.\nScreens 5, 6.', stroke: C.violet, background: C.bgViolet },
    { title: 'Beat 5', body: 'The model swap.\nScreens 12 then 1.\nCompress, never cut.', stroke: C.red, background: C.bgRed },
    { title: 'Beat 6', body: 'Human in the loop.\nScreens 7, 8.', stroke: C.orange, background: C.bgYellow },
    { title: 'Beats 7 & 8', body: 'Attributed research (9),\nthen audit from an\nunrehearsed pick (11).', stroke: C.green, background: C.bgGreen },
  ];
  const beatH = rowHeight(beats, beatCols.at(0).width);
  scene.group({
    x: X0,
    y: beatY,
    width: W,
    height: 82 + beatH + 30,
    label: 'DEMO BEAT → SCREEN',
    sublabel: 'Beats 3, 4 and 5 are independent: if a lane service is unhealthy, skip its beat and never debug live.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  beats.forEach((b, i) =>
    scene.box({
      stroke: C.ink,
      background: C.white,
      ...b,
      x: beatCols.at(i).x,
      y: beatY + 82,
      width: beatCols.at(i).width,
      height: beatH,
    }),
  );

  // ---- Required states ---------------------------------------------------
  const stateY = beatY + 82 + beatH + 30 + 70;
  const stateCols = columns({ x: X0 + 40, count: 5, width: (W - 80 - 4 * 40) / 5, gap: 40 });
  const states = [
    { title: 'Loading', body: 'Skeleton matching the final\nlayout. No layout shift on\na projector.' },
    { title: 'Empty', body: 'Explains what would populate\nit and how to trigger it.' },
    { title: 'Error', body: 'Names what failed and what\nstill works. Never a bare\n"Something went wrong".' },
    { title: 'Partial', body: 'Some lanes returned, some did\nnot. Show what exists, mark\nwhat is missing.' },
    {
      title: 'Degraded',
      body: 'Fallback source or stale data,\nlabelled inline. A demo that\nhides its own failure is one\nbad question from collapse.',
      stroke: C.orange,
      background: C.bgYellow,
    },
  ];
  const stateH = rowHeight(states, stateCols.at(0).width);
  scene.group({
    x: X0,
    y: stateY,
    width: W,
    height: 82 + stateH + 30,
    label: 'EVERY data view implements all five states',
    sublabel: 'The empty state nobody built is the one that renders during the live run.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  states.forEach((s, i) =>
    scene.box({
      stroke: C.ink,
      background: C.white,
      ...s,
      x: stateCols.at(i).x,
      y: stateY + 82,
      width: stateCols.at(i).width,
      height: stateH,
    }),
  );

  // ---- legend ------------------------------------------------------------
  const legendY = stateY + 82 + stateH + 30 + 60;
  scene.legend({
    x: X0,
    y: legendY,
    width: 1180,
    items: [
      { stroke: C.violet, background: C.bgViolet, text: 'Carries a wow moment. These three screens are the demo.' },
      LEGEND_HUMAN,
      { stroke: C.green, background: C.bgGreen, text: 'Evidence and audit surface — drillable to the record behind it.' },
      { stroke: C.blue, background: C.bgBlue, text: 'Supporting screen. Still drillable; nothing on screen is decorative.' },
      { stroke: C.red, background: C.bgRed, text: 'Required by a beat but NOT in the task list. Build it or lose Beat 5.' },
    ],
  });
  scene.box({
    x: X0 + 1180 + 60,
    y: legendY,
    width: W - 1180 - 60,
    title: 'Rules the whole UI obeys',
    body:
      'The audience reads this from ten feet away: every screen has one number that is deliberately the largest thing on it.\nNothing may look rehearsed — no pre-baked screenshots, no seeded animations. If a value is on screen it came from the API just now.\nEvery claim is drillable: a number a presenter cannot open is a number the audience assumes is decorative.\nPolling at 5s with refetchOnWindowFocus disabled, so a presenter alt-tabbing does not trigger a visible refetch mid-sentence.\nTypes are generated from contracts/*.md, never hand-written, because hand-written types drift and the drift surfaces during a demo.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

// ===========================================================================
// 05 — Source architecture (code map)
//
// The one diagram that answers "what actually exists in this repository today?".
// It follows the tree, not the plan: a project with no .csproj is drawn as a stub, because a
// newcomer who cannot tell built code from a placeholder will spend a day discovering it.
// ===========================================================================

export function srcArchitecture() {
  const scene = new Scene({ name: '05-src-architecture', seed: 0x55d6e7f8 });
  const X0 = 80;
  const W = 2720;
  const INNER_X = X0 + 40;
  const INNER_W = W - 80;

  scene.header({
    x: X0,
    y: 60,
    width: W,
    title: '05 · src/ code map — what is built, what is deliberately empty',
    subtitle:
      'Conclusion: the governed decision path is real, dependency-free, exhaustively tested code; the model invocation and the three lane services are NOT implemented, and nothing in the repository fakes them.',
  });

  // ---- Edge ---------------------------------------------------------------
  const edgeY = 210;
  const edgeCols = columns({ x: INNER_X, count: 2, width: (INNER_W - 40) / 2, gap: 40 });
  const edgeItems = [
    {
      title: 'src/webui  ·  Vite + React + TypeScript',
      body:
        'api/client.ts + api/types.generated.ts — types are GENERATED from the\ncontracts by scripts/generate-api-types.mjs and drift-checked in CI.\nshell/navigation.ts, ErrorBoundary.tsx, PlaceholderScreen.tsx\nstate/asyncState.ts + AsyncBoundary.tsx — the five required view states.\nScreens are still PlaceholderScreen: the shell is real, the beats are not.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: 'tools/Fcmr.CosmosProvision  ·  console',
      body:
        'Creates the six containers in the local Cosmos emulator, which Terraform\ncannot reach. The duplication with infrastructure/cosmos.tf is deliberate\nand guarded: scripts/policy-cosmos-containers-match.sh fails the build if\nthe two ever disagree about a name or a partition key.',
      stroke: C.ink,
      background: C.white,
    },
  ];
  const edgeH = rowHeight(edgeItems, edgeCols.at(0).width);
  const edge = edgeItems.map((s, i) =>
    scene.box({ ...s, x: edgeCols.at(i).x, y: edgeY, width: edgeCols.at(0).width, height: edgeH }),
  );

  // ---- Services (ASP.NET Core minimal APIs) -------------------------------
  const svcY = edgeY + edgeH + 120;
  const svcCols = columns({ x: INNER_X, count: 2, width: (INNER_W - 40) / 2, gap: 40 });
  const svcItems = [
    {
      title: 'src/router-service  ·  the only path to a model',
      body:
        'Routing/RouteRequestHandler.cs — POST /v1/route. Translates HTTP only.\nContracts/RouteRequestValidator.cs · Routing/RouteStatusMapper.cs\nConfiguration/ModelCatalog.cs + RouterOptions.cs\nSecurity/RouterAuthorization.cs — Router.Invoke app role\nCorrelation/CorrelationIdMiddleware.cs — one id, end to end\nPersistence/{RoutingDecisionStore, CosmosRoutingDecisionStore, CosmosClientFactory}.cs\nTelemetry/TelemetryRegistration.cs · Health/DecisionStoreHealthCheck.cs',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: 'src/approvals-service  ·  the human gate',
      body:
        'Endpoints/ApprovalEndpoints.cs — propose · approve · reject · get.\nSecurity/ApprovalsAuthorization.cs — Proposer and Approver app roles,\ncaller identity read from the token oid claim, never from the body (ADR-011).\nPersistence/ApprovalStore.cs — IN-MEMORY today; Cosmos is T-014a.\nEvery refusal is audited too: "someone tried to approve their own\nproposal and was stopped" is the record an auditor comes looking for.',
      stroke: C.orange,
      background: C.bgYellow,
    },
  ];
  const svcH = rowHeight(svcItems, svcCols.at(0).width);
  const svc = svcItems.map((s, i) =>
    scene.box({ ...s, x: svcCols.at(i).x, y: svcY, width: svcCols.at(0).width, height: svcH }),
  );

  // ---- Domain assemblies ---------------------------------------------------
  const domY = svcY + svcH + 130;
  const domCols = columns({ x: INNER_X + 20, count: 3, width: (INNER_W - 40 - 2 * 40) / 3, gap: 40 });
  const domItems = [
    {
      title: 'src/Fcmr.Router.Decisions',
      body:
        'ZERO dependencies, by design.\nPolicyGate.cs — runs FIRST\nComplexityScorer.cs — pure\nTierSelector.cs · RoutingPlanner.cs\nPolicySetRepository + Validation\nRoutingDecision · ModelTier · ModelVendor\n\nNo ASP.NET, no Azure SDK, no clock.\nThat is what makes it exhaustively\ntestable — and it is coverage-gated\nat 70%, checked by scripts/check-coverage.sh.',
      stroke: C.blue,
      background: C.bgBlue,
    },
    {
      title: 'src/Fcmr.Approvals.Domain',
      body:
        'ApprovalStateMachine.cs · Approval.cs\nApprovalState / Command / Refusal\nEvidencePacket.cs · ExecutionGate.cs\nApprovalAuditEvent.cs\n\nNothing here can execute anything.\nThe strongest statement it can make\nis an ExecutionGate — an authorisation,\nnot a receipt. Whatever acts must\npresent one (ADR-008).',
      stroke: C.orange,
      background: C.bgYellow,
    },
    {
      title: 'src/Fcmr.Demo.Data',
      body:
        'DemoDataGenerator.cs\nDemoUniverse.cs · DemoRecords.cs\nDeterministicRandom.cs\n\nSynthetic only, seeded, committed.\nThe generated volume is gitignored,\nso the repository carries the recipe\nrather than the data (Principle VII).\nNo real counterparty exists anywhere.',
      stroke: C.green,
      background: C.bgGreen,
    },
  ];
  const domH = rowHeight(domItems, domCols.at(0).width);
  scene.group({
    x: X0,
    y: domY - 84,
    width: W,
    height: 84 + domH + 34,
    label: 'DOMAIN ASSEMBLIES — the rules live here, never in an endpoint',
    sublabel:
      'Handlers translate HTTP and nothing else. A rule reachable only through a controller is a rule that can only be tested through a socket.',
    stroke: C.ink,
    background: C.white,
    strokeWidth: 3,
  });
  const dom = domItems.map((s, i) =>
    scene.box({ ...s, x: domCols.at(i).x, y: domY, width: domCols.at(0).width, height: domH }),
  );

  // ---- Not implemented -----------------------------------------------------
  const gapY = domY + domH + 150;
  const gapCols = columns({ x: INNER_X + 20, count: 4, width: (INNER_W - 40 - 3 * 40) / 4, gap: 40 });
  const gapItems = [
    {
      title: 'src/research-service',
      body: 'README.md only.\nNo .csproj, no code.\nTask T-023.',
    },
    {
      title: 'src/surveillance-service',
      body: 'README.md only.\nNo .csproj, no code.\nTask T-024.',
    },
    {
      title: 'src/orderrouting-service',
      body: 'README.md only.\nNo .csproj, no code.\nTask T-025.',
    },
    {
      title: 'Model invocation',
      body:
        'RouteRequestHandler returns\nInferenceState.NotInvoked.\nNo vendor is called yet.\nADR-007 forbids a canned\nreply standing in for one.',
    },
  ];
  const gapH = rowHeight(gapItems, gapCols.at(0).width);
  scene.group({
    x: X0,
    y: gapY - 84,
    width: W,
    height: 84 + gapH + 34,
    label: 'NOT IMPLEMENTED — and drawn here so the gap is visible rather than assumed',
    sublabel:
      'Awaiting the Azure subscription window. ADR-007: when a dependency is unreachable the system says which one and refuses — it never substitutes a recorded result.',
    stroke: C.red,
    background: C.white,
    strokeWidth: 3,
    strokeStyle: 'dashed',
  });
  gapItems.forEach((s, i) =>
    scene.box({
      ...s,
      x: gapCols.at(i).x,
      y: gapY,
      width: gapCols.at(0).width,
      height: gapH,
      stroke: C.red,
      background: C.white,
      strokeStyle: 'dashed',
    }),
  );

  // ---- Tests ---------------------------------------------------------------
  const testY = gapY + gapH + 150;
  const testCols = columns({ x: INNER_X + 20, count: 6, width: (INNER_W - 40 - 5 * 40) / 6, gap: 40 });
  const testItems = [
    { title: 'Router.Decisions.Tests', body: 'The 70% gate.\nPure unit tests.' },
    { title: 'Approvals.Domain.Tests', body: 'State machine and\nsegregation of duties.' },
    { title: 'RouterService.Tests', body: 'Handler, validator,\nstatus mapping.' },
    { title: 'Contract.Tests', body: 'Both APIs through\ntheir published surface.' },
    { title: 'Persistence.Tests', body: 'Real Cosmos emulator.\nFails loudly, never skips.' },
    { title: 'Demo.Data.Tests', body: 'Generator determinism.' },
  ];
  const testH = rowHeight(testItems, testCols.at(0).width);
  scene.group({
    x: X0,
    y: testY - 84,
    width: W,
    height: 84 + testH + 34,
    label: 'tests/ — six projects',
    sublabel:
      'The persistence suite runs against a real Cosmos engine in Docker and fails with instructions when it is absent, rather than skipping green.',
    stroke: C.green,
    background: C.bgGreen,
    strokeWidth: 3,
  });
  testItems.forEach((s, i) =>
    scene.box({
      ...s,
      x: testCols.at(i).x,
      y: testY,
      width: testCols.at(0).width,
      height: testH,
      stroke: C.green,
      background: C.white,
      titleSize: 18,
    }),
  );

  // ---- Flow arrows ---------------------------------------------------------
  scene.arrow(edge[0], svc[0], {
    sides: ['bottom', 'top'],
    label: 'POST /v1/route\nEntra token',
    color: C.blue,
  });
  // Routed along the gap between the two rows rather than straight across, so it does not cut
  // diagonally through the domain band below.
  scene.arrow(edge[0], svc[1], {
    sides: ['bottom', 'top'],
    elbow: 'h',
    label: 'propose / approve\ntwo distinct identities',
    color: C.orange,
    // Placed explicitly in the clear gap between the two rows; the polyline centroid would land
    // a third of the way down the descent, inside the box to its right.
    labelAt: { x: (edge[0].cx + svc[1].cx) / 2, y: edgeY + edgeH + 62 },
  });
  // labelDy lifts these clear of the DOMAIN ASSEMBLIES group header the arrows pass through.
  scene.arrow(svc[0], dom[0], {
    sides: ['bottom', 'top'],
    label: 'the whole decision',
    color: C.blue,
    labelDy: -34,
  });
  scene.arrow(svc[1], dom[1], {
    sides: ['bottom', 'top'],
    label: 'the whole ruleset',
    color: C.orange,
    labelDy: -34,
  });

  // ---- legend --------------------------------------------------------------
  const legendY = testY + testH + 110;
  scene.legend({
    x: X0,
    y: legendY,
    width: 1260,
    items: [
      LEGEND_CHOKEPOINT,
      LEGEND_HUMAN,
      { stroke: C.green, background: C.bgGreen, text: 'Synthetic data and the tests that prove the rest.' },
      {
        stroke: C.red,
        background: C.white,
        strokeStyle: 'dashed',
        text: 'NOT implemented. README only, or an explicit NotInvoked.',
      },
    ],
  });
  scene.box({
    x: X0 + 1260 + 60,
    y: legendY,
    width: W - 1260 - 60,
    title: 'How to read this repository in the right order',
    body:
      'Start at src/Fcmr.Router.Decisions. It has no dependencies, it holds every routing rule, and it is the only assembly the demo\'s central claim actually rests on — governance decides, the application does not.\nThen src/Fcmr.Approvals.Domain, which holds the human gate and, deliberately, no ability to act on it.\nThe services above them are thin on purpose: if you find a rule inside an endpoint, that is a defect, not a shortcut.\nEverything in the dashed red band is absent, not hidden. The demo can currently prove its governance and its privacy; it cannot yet prove an end-to-end model call, and it does not pretend to.',
    stroke: C.blue,
    background: C.white,
  });

  return scene;
}

export const DIAGRAMS = [
  { file: '01-platform-topology.excalidraw', build: platformTopology },
  { file: '02-request-decision-flow.excalidraw', build: requestDecisionFlow },
  { file: '03-agent-architecture.excalidraw', build: agentArchitecture },
  { file: '04-ui-screen-map.excalidraw', build: uiScreenMap },
  { file: '05-src-architecture.excalidraw', build: srcArchitecture },
];
