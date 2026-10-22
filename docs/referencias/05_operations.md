# FUNIX — Operations Operating System

## 1. Purpose and boundaries

This document is the **single conceptual owner** of FUNIX's repair execution, production flow, quality acceptance, repair-family classification, technical-effort calibration, workforce coverage, and operational supervision. It describes how FUNIX intends to deliver consistently conforming work with improving economic productivity.

It is **not** a technical repair manual, an approved inspection checklist, a floor-layout decision, or proof that a described method is in daily use. Actual technical instructions, approved acceptance criteria, authorized signatories and operating baselines must be identified separately. For document precedence and binding limits use `00_master_index.md`, Section 5; for decision method and measurement vocabulary use `09_decision_framework.md`; for strategic priorities use `10_strategy.md`.

`04_sales.md` owns commercial contact, pricing conversations and promises; `06_legal_and_policy.md` owns legal controls, consent and warranties; `07_digital.md` owns data implementation and live integration status; `02_business_model.md` owns job economics. Operations must work coherently with each without redefining their policies.

## 2. Operational intent

**Produce more consistently accepted, technically responsible repair work per relevant resource when doing so improves sustainable business results.** Standard work, capable people, good flow, appropriate tools, verified quality and continuous learning are the means—not raw delivery count, maximum individual busyness, machines for display, or a fixed industrial layout.

Operational integrity applies equally to visible and hidden work. The mentality *“The customer will never notice”* is unacceptable. A gain in speed that increases defects, unsafe work, unrecorded overtime, outsourcing, warranty expense, or customer disruption is not an established efficiency gain.

**Demand and capacity are distinct.** If no profitable demand can absorb recovered production time and no avoidable cost is removed, increased capacity alone may not create profit. Operations should supply factual measures of available capacity, queues, blockers and costs so the business can identify the active constraint; `10_strategy.md` determines the enterprise priority.

## 3. Service families and repair variability

FUNIX's working focus is body repair and automotive paint associated principally with small and medium damage. Polishing, coating and other aesthetic services may complement this work; insurer and institutional jobs can have distinct approval and billing dependencies. Extreme reconstruction and restoration-grade projects are not presumed standard production offerings.

**Do not treat all vehicles or jobs as comparable units.** Develop a small, revisable classification of repair families using factors that materially affect work: damage and scope, part/material needs, process route, technical effort, resource requirements, inspection points and sources of waiting. Bumpers, repair-and-paint panels, replacement-and-paint parts, and aesthetic work are **candidate groups**, not an approved taxonomy.

Each family should eventually have an owner, applicable technical instructions, acceptance criteria, indicative work content, principal dependencies and a way to record exceptions. Start with families recurring often enough to produce usable observations. Rare or complex jobs may follow an explicitly managed case-specific route instead of being forced into a standard line.

## 4. Quality: what must be accepted

FUNIX distinguishes three layers:

1. **Technical integrity — mandatory:** safety, functional correctness, structural suitability, durability, appropriate repair methods, compatible materials/parts, and applicable manufacturer and regulatory requirements.
2. **Contracted delivery quality — mandatory:** fit, alignment, paint/finish consistency, complete approved scope, functioning components and presentation meeting the **approved acceptance criteria applicable to that repair**.
3. **Extra refinement — only by scope:** unusual cosmetic perfection, customization or restoration-level work that goes beyond the contracted service. Extra refinement cannot be used as a label to excuse a defect in layers 1 or 2.

### 4.1. Acceptance standard by repair family — required development

The responsible technical function must develop and approve **service-family acceptance standards** that specify, as relevant:

- applicable technical source and version (manufacturer instructions, product systems, mandatory requirements and validated internal methods);
- critical characteristics: safety/function, hidden-work integrity, part fit, repair shape, alignment, coating/paint, finish and completeness;
- objective tolerances or qualified inspection references where technically applicable; do not invent generic universal numbers;
- how and at what stage the characteristic is checked, with necessary conditions, equipment and evidence;
- what constitutes a nonconformity, who is qualified to judge it, corrective steps and reinspection;
- distinction between an approved alternative scope, documented limitation and an unacceptable defect;
- technical sign-off and release authority, authorized substitute and escalation path.

An inspection checklist supports these standards; **a checklist or a document title is not itself evidence of technical conformity**. Criteria should be usable by trained staff and updated through observed failures, current technical information and appropriate approvals.

### 4.2. Rule while these standards or authorities are incomplete

Until acceptance criteria are formally approved, apply **the single interim quality and release rule in `09_decision_framework.md`, Section 3**. Do not lower standards because a numeric tolerance is unavailable. Suspected technical, hidden, functional, durability, fitment or finish nonconformity—including inconsistency with the authorized scope—requires competent technical assessment. Do not designate a vehicle technically approved for release while material conformity remains unresolved.

The responsible technical authority **and a competent authorized substitute** must be formally named in `FUNIX_REGISTROS_VIVOS.md`, Section B (open item `GOV-01`); the standards remain open as `GOV-04`. **No authority or exception is created by this document.** If the authority is unavailable, follow the interim hold, communication and technical/legal escalation requirements in `09`, respecting customer rights. A customer request does not by itself waive technical or safety requirements.

### 4.3. Quality at the source and after delivery

Build checks into consequential transitions: after scope/technical verification, before closing hidden work, before costly downstream stages where relevant, and before technical release. Define who executes and who verifies; independent checking is a **capability to develop when justified**, not an assertion that FUNIX currently employs a dedicated inspector.

Record significant defects and causes. Distinguish internal rework, warranty-related correction, customer-authorized additions and unrelated later damage. Monitor both first-pass inspection acceptance **and** documented quality returns after delivery; a relaxed final inspection must not create the illusion of improved quality.

## 5. End-to-end service control

The operational control points are:

1. **Commercial handoff:** verified customer/vehicle, approved scope and price conditions, delivery expectation, parts and unresolved assumptions.
2. **Receipt / `Inspeção de Recebimento`:** condition, visible damage, keys/belongings and relevant custody records; capture only necessary information.
3. **Technical verification:** confirm feasibility, repair plan and hidden-damage uncertainty; trigger a documented change request when necessary.
4. **Readiness and scheduling:** confirm parts, information, competent staff, equipment and constrained resources before releasing work.
5. **Execution and in-process control:** apply current authorized methods; record material deviations and stop points.
6. **Finishing, assembly and `Inspeção de Entrega`:** verify scope completion, technical conformity and customer-facing condition before release.
7. **Customer handover and closure:** communicate relevant outcomes, changes, limitations and documented warranties; record deviations and learning.

These are **management controls, not a mandatory sequence of physical stations**. Actual routes may branch, repeat, or include outsourced work. ERP labels such as `Pátio`, `Fluxo Colorimétrico`, `Fluxo Estético`, or `Concierge de Peças` are terms from developing workflows, **not proof of live operational adoption**. The status and authority of each digital control must be checked in the dated register and in `07`.

Material changes in repair scope, price or timing require appropriate internal authority, customer communication and authorization under `04` and `06`, *before* additional paid work where required. Photograph-based guidance remains preliminary where physical inspection, disassembly or technical verification is needed.

## 6. Production flow and current constraint

Maintain practical visibility of: approved jobs awaiting production, vehicles released to production, work waiting at stages, blockers, expected completion, work that can proceed, and responsible next actions. Differentiate **customer custody time**, production-release-to-ready time, actual touch time and idle/waiting time; metric definitions belong to `09`, Section 6.

Possible constraints include approved demand, cash, parts and authorizations, body work, preparation, paint booth/curing, assembly, polishing, technical release, or management attention. **Do not designate any resource as the bottleneck by intuition alone.** Use recent queues, observed work, stoppages and capacity to diagnose it; another family or week may have a different constraint.

Practical production rules:

- Release work based on genuine readiness and realistic capacity, not simply the number of vehicles on site.
- Identify blocked work explicitly; assign an owner and next action instead of allowing silent waiting.
- Avoid unnecessary movements, duplicated handling, excessive starts and downstream congestion.
- Protect quality checks and delivery promises while adjusting sequencing to actual constraints.
- Reserve justified time for maintenance, training, cross-coverage and recovery; 100% individual utilization is not necessarily maximum workshop output.
- If demand is the constraint, make capacity and service readiness visible to commercial management rather than generating WIP without authorized work.

No WIP limit, dispatching rule, shift arrangement, target utilization or meeting cadence is adopted here. Choose lightweight controls by observed benefit and actual team capacity.

## 7. People, skill coverage and supervision

Competent technicians and practical craftsmanship are assets to develop, **not interchangeable labor units**. FUNIX wants repeatable performance without relying on a single indispensable person. Better process documentation, training and staffing coverage should lower risk, but headcount growth alone does not provide resilience.

The operations leader should develop a **critical-skills and coverage map**, listing for each essential activity: qualified primary person(s), competent backup(s), training needs, equipment/access requirements, stop/authorization boundaries and continuity plan. **Only actually qualified and authorized staff may perform safety- or competence-sensitive tasks.** A backup name on paper is not proof of competence.

When a critical professional is unexpectedly absent:

1. Identify affected work and technical/capacity constraints.
2. Reassign only within demonstrated competence and actual delegation; otherwise suspend or resequence the affected stage.
3. Review parts, downstream commitments, revised capacity and customer deadlines.
4. Communicate material delay promptly; record a next action and recovery decision.
5. Afterward, assess whether cross-training, coverage, work standards, buffering, outside support or additional staffing is economically justified.

Operational supervision must have identifiable accountability for safety, quality, workload, training, exceptions and escalation. The specific named operations and technical authorities, their backups and limits **remain to be registered**, not inferred from job titles. Employment, working-hour, remuneration and safety policies belong to `06`; resource economics belong to `02`.

Encourage staff to report defects, bottlenecks and near misses without making concealment the rational response to productivity incentives. Any future gain-sharing or incentive scheme requires a separate economic, people and legal decision, not an implied promise.

## 8. Standard work, improvement and learning

For tasks repeated often enough to justify it, define the **current best-known safe method**: scope of application, tools and materials, critical steps, quality/stop points, competent executor, evidence, and allowed technical deviations. Use short visual aids and training where more effective than lengthy instructions. Preserve professional judgment for real variation; justify and record meaningful departures rather than allowing silent personal methods.

Apply a **proportionate improvement loop**:

1. Define the problem, the repair family and the customer/economic result sought.
2. Observe the baseline: time, delays, work mix, quality and resource burden.
3. Identify likely causes and the smallest realistic change; protect mandatory controls.
4. Test with a stated scope, sample, confounders, responsible person and stop/reversal condition proportionate to risk.
5. Evaluate accepted comparable output, rework, customer effects and actual cost—not only apparent speed.
6. If confirmed, approve and teach the updated method; otherwise adjust or revert.

A standard is the baseline for further improvement, not a permanent end state. Do not require a large simulation for a low-risk reversible change; do not treat a tiny uncontrolled trial as proof for capital investment or a universal production policy. Use the `09` decision method and the single live log for significant decisions.

## 9. Measuring work without inventing equivalence

**Primary interim practice:** report accepted jobs **within repair families**, alongside actual effort, elapsed time, queue/waiting time, rework and quality returns. Do not claim that doubling the count of delivered vehicles proves doubled productivity if the mix, overtime, outsourcing, effort or quality changed.

The metric definitions, numerator/denominator and observation periods are owned by `09_decision_framework.md`, Section 6. Operations owns the **collection and technical calibration** underlying them. Use the same defined event boundaries for each comparison.

### Development of an equivalent-work unit

- Start with a small sample of representative **completed and conforming** jobs/stages from recurring repair families.
- Record actual task-level labor effort, waiting separately, rework, job characteristics and legitimate scope deviations.
- Estimate initial family/task standards and inspect variability; do not let one exceptional job define the unit.
- Check the proposed standards against later jobs, rework, labor availability and changes in mix; revise when evidence justifies it.
- Until validated, label standards **provisional** and avoid ranking individuals or quoting margins from them as if they were calibrated cost measures.

**Pricing “energy factors” are not validated labor-hour, touch-time or unit-cost measures.** They may assist price allocation in the developing system but require explicit calibration against observed effort and economics before serving production targets, staffing decisions or automated margin claims. Coordinate with `02`, `04` and `07` before scaling automated quotes based on untested factors (`GOV-06`).

Identify the operational facts needed to determine current constraint and improvement return; enter dated baselines in `FUNIX_REGISTROS_VIVOS.md`, Section B. Keep implementation details and technical schemas out of this conceptual document.

## 10. Production architecture and equipment — deliberately open

The following are **untested alternatives**, not a commitment to a Fordist line:

- multi-skilled technicians or small teams covering multiple stages;
- specialists assigned by stage with defined handoffs;
- repair-family cells with shared specialized resources;
- vehicles fixed at bays versus vehicles physically moving between stations.

**Skill specialization and physical vehicle movement are separate variables.** Compare alternatives through accepted equivalent output (when reliable), customer/production lead time, WIP, first-pass and post-delivery quality, skill coverage, internal movement, space, cost, and supervisory burden. When equivalence is not reliable, start with like-for-like families and explicit limitations.

Continue the existing authorized safe configuration while mapping its losses; make proportionate pilots before irreversible changes. Automation, robotics, tooling and machinery must solve a specified problem with defensible **whole-life economics**: purchase, installation, maintenance, training, quality effects, downtime, utilization, labor alternatives, financing and cash. A more automated system is not necessarily more efficient.

Major expansion, including the **possible larger facility discussed by leadership**, depends on proven demand, process results, room/booth constraints, staff coverage, management capability, cash and capital return. The scale ambition itself belongs to `10_strategy.md`, not this operating standard.

## 11. Timelines, parts and third-party dependencies

Commit credible service dates using actual scope, parts availability, insurer/customer approvals, skill and equipment readiness, queue position and required quality controls. Original references of roughly five business days for small repairs, eight for medium repairs and one to two days for aesthetics are **historical and unvalidated as present company commitments**; dated baselines belong in the live register.

Parts and outsourced services must meet technical appropriateness, traceability and authorization requirements. Evaluate procurement by **total effect**—price, availability, fit, delay, rehandling, return and defect cost—rather than item price alone. Do not assume an insurer or supplier will approve something FUNIX cannot control.

When a material commitment is endangered: identify the cause, affected work and responsible party; update the customer early without invented certainty; record a realistic next step; and learn from recurring causes. Warranty terms, consumer rights and any required reauthorization belong to `06`.

## 12. Operational exceptions and unresolved work

Use the **single decision and validation log** in `FUNIX_REGISTROS_VIVOS.md`, Section C, rather than keeping a second departmental backlog. The current work includes:

- `GOV-01`: appoint technical quality/release authority and authorized backup;
- `GOV-04`: approve repair-family acceptance criteria and inspection roles;
- `GOV-03`: measure current operating constraints, queues and capacity;
- `GOV-06`: verify actual costs, task effort and pricing-factor calibration.

These entries are **open**, not approved policies, and their responsible persons are not assumed. Other operational choices—including exact layout, family taxonomy, cross-coverage levels, WIP limits, inspection staffing, equipment and detailed service-time targets—remain hypotheses until supported by evidence and properly authorized.

A material exception must have a known affected job/customer, responsible next action, appropriate internal technical/commercial authority, authorization where required, and a documented outcome. Do not let a software status or absence of a written numeric limit substitute for a qualified decision.

## 13. Operating principles for AI and managers

- Respect mandatory repair integrity, customer authorization, worker safety and validated quality requirements before seeking speed or cost savings.
- Use `09`, Section 3, for the **single interim quality rule** until adopted family standards exist; do not create parallel release rules here.
- Treat operational examples, old targets, draft checklists, developed digital flows and proposed production layouts as different from verified adopted practice.
- Separate demand, accepted throughput, job mix, true resource effort, queues, rework, cash implications and reliable service outcomes.
- Develop people's competence, supervisory capacity and coverage instead of treating staffing as an interchangeable headcount problem.
- Prefer small, testable changes; require stronger proof for safety-critical changes, major investments or binding commitments.
- Keep process documentation **usable on the workshop floor** and avoid adding records whose cost exceeds their operational value.

**Operational objective:** consistently conforming repairs, steady flow, stronger capacity per real resource, dependable delivery, less vulnerability to single-person failures, and evidence of actual economic benefit.
