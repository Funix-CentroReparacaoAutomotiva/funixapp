# FUNIX — Digital Operating System

**Release and deployment:** Consult `FUNIX_REGISTROS_VIVOS.md` for the approved document release and dated status of each digital capability. Specifications, working prototypes, tested integrations and stable deployed workflows are distinct. This file does not certify that a named tool, campaign or automation is operational.

## 1. Purpose and boundaries

This file owns **digital architecture and implementation governance** for acquisition systems, CRM/ERP, records, integration, analytics, automation, AI and operational technology. It is not the owner of customer psychology (`03`), sales rules (`04`), technical criteria (`05`), legal/privacy policy (`06`), visual/message design (`08`), metric definitions (`09`) or investment priority (`10`). Refer to the precedence and evidence statuses in `00_master_index.md`.

**Goal:** Make customer acquisition and repair operations easier to execute, coordinate, measure and improve with reliable, maintainable tools. Software is an instrument of efficiency, not proof of it. The simplest sufficient solution is preferable to an impressive but fragile technical stack.

## 2. Two connected digital functions

**External: acquisition and customer access.** Help relevant customers discover FUNIX, verify its competence and legitimacy, understand next steps, contact the shop and authorize viable repairs without friction.

**Internal: commercial and production infrastructure.** Connect contact, vehicle, diagnosis, quote, approvals, work order, parts, execution, quality review, handover and aftercare into a coherent information flow. Support accountable work, customer updates, measurement and exception handling.

Neither function should optimize activity counts in isolation. More leads, clicks, records, webhooks or dashboards are not sufficient evidence of more profitable conforming repairs.

## 3. Implementation reality: confirm per capability

Work discussed during FUNIX development includes **Coda tables and formulas**, service/pricing catalog design, structured quotation and OS models, **Coda Pack/n8n webhooks**, WhatsApp workflows, possible voice-assisted quoting, the A4 vehicle reception checklist and digital acquisition architecture. These are **design/development evidence**, not blanket proof of production reliability.

For each capability, the live register should identify: **status (planned / prototyped / tested / operating / suspended), current use case, accountable person, last verified date, source of evidence, failure mode and next review**. Do not represent Google Ads, GTM, GA4, public landing pages or production dashboards as implemented until their actual configuration and operation are confirmed.

Do not freeze URLs, webhook hosts, API secrets, table IDs, column names, monetary formulas, interface labels or technical status names in this conceptual file. Maintain those in **controlled implementation specifications** linked from the live register; that separation permits platform changes without redefining company strategy.

## 4. Information architecture and authoritative records

Build the minimum coherent model needed to connect:

- **Customer and contact:** a reliable current contact identity, permissible communication channels and relevant history.
- **Vehicle:** identification, relationship to customer, documented condition and service context.
- **Commercial case:** originating inquiry, current next action, scope under consideration, quote versions and outcome.
- **Quotation and approval:** itemized offered service, assumptions, authorized version, amount and evidence of acceptance.
- **Work order:** what is actually authorized for production, operating stages, parts/dependencies, relevant quality controls and status.
- **Handover and post-delivery:** recorded release and return, complaints, legitimate rework and follow-up.

Define **which record/system is authoritative** for each field and event. Capture information once where possible, reuse it when lawful and accurate, and do not permit an unverified identity match, duplicate entry or stale message to modify an approved scope.

Distinguish **commercial service** from **technical execution stage**. A customer should see understandable work and conditions; internal procedures can use more granular stages. Keep pricing snapshots and approved work orders traceable rather than continuously recalculating a previously accepted offer without controlled revision.

Initial contact should not require full registration when a minimal contact and repair description will suffice. Collect additional customer/vehicle details when the approved quotation, inspection or OS process actually requires them (`04`, `06`). Normalize contact and vehicle identifiers in implementation code with tests, not merely by assuming every input is valid.

## 5. Workflow states and handoffs

Design clear transitions for: inquiry → guidance/inspection when needed → quote issued → approved/deferred/rejected → work order/production → quality release → delivery/aftercare. These are **conceptual states**, not necessarily exact adopted CRM statuses.

Each transaction should make visible: current stage, next responsible role, pending customer/insurer/parts decision, date/commitment, current approved scope and whether an exception requires escalation. Not every micro-step needs its own status or screen.

A sales approval does not automatically imply available technical capacity, approved parts or a ready production slot. A technical completion event does not by itself prove customer delivery, payment or satisfaction. Respect the actual approvals and event definitions in `04`, `05`, `06` and `09`.

## 6. Automation and reliability

Prioritize repeatable high-friction work only when the benefit can be demonstrated: correct data transfer, reminders, status synchronization, document preparation, noncritical classifications and controlled management reporting.

Minimum reliability practices for financially or operationally material flows:

- stable transaction identifiers, duplication guards and idempotent retries;
- validation of required inputs and legitimate status transitions;
- controlled treatment of conflicting edits and out-of-order events;
- logs that identify errors without exposing unnecessary personal information;
- an explicit retry/reconciliation and manual-recovery path for partial failures;
- visible ownership of credentials, access permissions, backups and vendor dependencies;
- tested fallback procedures when a critical integration is unavailable.

Do not remove useful authentication because it is inconvenient; assess actual threat, architecture and costs. A webhook that succeeds once is not validated continuity. Do not create duplicate customer messages, OSs, charges or quotes due to retries.

**Automation cannot grant its own decision authority.** It must not secretly change final quotes, accept customer terms, approve extra paid work, treat a possible service as definitive, claim a repair was inspected, or override technical/customer escalation.

## 7. AI assistance and technical pricing safeguards

AI may summarize, classify, draft, detect inconsistencies or structure dictated information **for attributable human review**. Its outputs do not prove customer history, physical inspection, legal compliance, verified costs or approvals. Control sensitive information in prompts, logs and vendors under `06`.

The evolving **energy-factor/service-catalog model is a pricing-design mechanism**, not a certified proxy for labor time, direct cost or margin. Before scaling automated or voice-generated quotes, sample actual execution effort, relevant costs and quality by repair family, compare with modeled values, review deviations and approve decision rights (`02`, `04`, `05`, `09`). If validation is incomplete, label resulting numbers and require appropriate human review; do not claim a calibrated automated quote engine.

## 8. Metrics and management information

Use the single **provisional metric dictionary in `09_decision_framework.md` Section 6**. `07` governs collection and implementation, not competing denominators or formulas.

Build measurement outward from trustworthy business events:

1. Web/customer interaction (contact click or form submitted).
2. Actual lead/meaningful first response.
3. Formal quotation issued and customer-approved version.
4. Work order released, quality checked and vehicle delivered.
5. Post-delivery issue, collected revenue and economically valid job contribution when data permit.

An interaction is not a qualified lead, a quote is not revenue, and approval is not delivery. Each event needs a defined timestamp, source, trigger, producer, deduplication rule and exception handling. Track unknown attribution as unknown.

A small initial dashboard should answer current constraint questions: quotes entering and converting; approved jobs awaiting start; critical-resource availability; WIP and blocked work; delivery reliability; rework and post-delivery problems; cost/contribution when properly measured. Add sophistication only if the decision benefit warrants data and maintenance cost.

## 9. Website and acquisition architecture

Retain the original preference for **a unified, company-controlled root domain**, a credible institutional site and focused service/landing pages only when useful. Illustrative possible paths (not live URLs) include `/`, `/funilaria`, `/estetica` and `/consultoria`. Avoid fragmented subbrands, duplicate content and closed ownership arrangements.

- **Institutional:** show that the company exists, where it is, what repairs it does, authentic evidence, contact, practical process and only validated guarantees.
- **Service/landing pages:** address a clear repair need and offer one straightforward next action, without forcing an educational detour.
- **Acquisition channels:** Google Business Profile, local search and intent-oriented Google Ads remain reasonable **working hypotheses**, alongside referrals and returning customers; Meta and other experiments require observed economics and capacity fit.

`08_brand_assets.md` owns how the site looks, sounds and presents its proof; `03` owns customer interpretations; `04` owns commercial contact; `06` owns data and claims boundaries. Mobile-first usability, clear tap targets, readable content and load performance are default design requirements, not decorative extras.

## 10. Measurement of marketing without vanity

Potential tools include Google Tag Manager, GA4, Google Ads data, Google Business Profile and controlled UTM conventions. Confirm real ownership, correct implementation and reliable event collection before calling any metric operational.

Minimum campaign tags, where appropriate: source, medium and campaign; content and term only when useful. Trace attribution into actual consultations, quotes and delivered work **only if the data support it**, explaining offline and cross-device blind spots. Do not optimize marketing solely for WhatsApp button clicks if those clicks do not become executable, profitable repairs.

Local SEO should prioritize accurate services, contact details, site performance, genuine evidence and useful content, not spam or unsupported rankings. Optional tools (heatmaps, session recordings, pixels, call tracking) require demonstrable utility, privacy review and ongoing ownership.

## 11. Security, ownership, continuity and change control

FUNIX should control its domain, accounts, credentials, records, backup/recovery capability and the exportability of business-critical data. Avoid sole dependency on a vendor, integrator or undocumented individual. Define accountable product/technical ownership when the business relies materially on a digital workflow.

For a new change or integration, record: problem and affected decision, current baseline, proposed benefit, costs and failure risks, test scope, rollback plan, approval/technical owner and observed result. Adopt progressively rather than building all possible features at once. Stop or simplify initiatives whose operating benefit no longer justifies upkeep or risk.

Specific legal/privacy controls, employee/customer rights and data retention require validated guidance under `06`. Concrete deployments and their dated status belong in the live register, not repeated permanent descriptions here.

## 12. Rules while capabilities remain incomplete

- Preserve an authorized manual process for critical work until the digital path is proven dependable.
- Do not infer live functionality or successful data synchronization from a specification.
- Do not use a simulated cost, quality measure or customer approval as fact.
- Do not add broad AI autonomy or omit mandatory validation merely to reduce clicks.
- Prefer verifiable time saved, fewer errors and reliable decisions over dashboards or integrations without adoption.
- Keep the strategic aim visible: make **good repairs easier to deliver profitably and consistently**, not technology more prominent.

Unresolved technical investments, capability reviews and implementation decisions must be captured **once in `FUNIX_REGISTROS_VIVOS.md`, Section C**, with priorities owned by `10_strategy.md`. Detailed current specs live outside these eleven conceptual files.
