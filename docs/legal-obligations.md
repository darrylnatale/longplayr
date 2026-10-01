# Legal obligations

**Researched 2026-09-24.** Discharges the blocking precondition in `docs/product-spec.md` §10.4, which has held direct messaging since 2026-08-18.

> ## ⚠️ This is not legal advice
>
> **It is desk research by a non-lawyer**, done to the standard §10.4 asks for: identify what actually applies to a service of this size, separate legal requirements from good practice, cite current sources, and flag what needs a professional rather than presenting it as settled.
>
> **Several items below are flagged as needing professional advice.** Those flags are the most important content in this document. **Do not treat an unflagged item as certain either** — treat it as researched.
>
> **The law moves and this page does not.** Re-check before launch, and again before anything here is relied on.

---

## 1. What longplayr is, legally

| Question           | Answer                           | Why it matters                                                                                                 |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Hosting service?   | **Yes**                          | Stores information provided by users — reviews, lists, profiles. Triggers DSA Section 2 **regardless of size** |
| Online platform?   | **Yes, for its public surfaces** | Stores _and_ disseminates to the public. Triggers Section 3 — but see the exclusion below                      |
| Micro enterprise?  | **Yes**                          | One person, no turnover. Art 19 excludes Section 3                                                             |
| Established where? | **Germany**                      | The Digitale-Dienste-Gesetz applies; the coordinator is the Bundesnetzagentur                                  |

**"Dissemination to the public" is the hinge**, and DSA Recital 14 defines it as making information available to _a potentially unlimited number of persons_. longplayr's reviews, lists and profiles are readable by anyone — `CLAUDE.md`'s _everything user-generated is public_ — so they plainly qualify.

---

## 2. What applies now, today, before any messaging exists

**This is the part that was not expected.** The research was commissioned for messaging; **most of what it found applies to the product as it already stands.**

### 2.1 Legal requirements

| Obligation                                                                                                                 | Source                                                  | State in longplayr                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Notice-and-action mechanism** — an easy-to-access, user-friendly electronic way for **anyone** to report illegal content | DSA **Art 16**, hosting services, **no size exclusion** | **Not built.** Phase 6 slice 3                                                             |
| **Statement of reasons** — tell a user _why_ their content was removed or restricted, with specified detail                | DSA **Art 17**, hosting services, **no size exclusion** | **Not built.** §92 can suspend and remove; nothing explains itself to the person affected  |
| **Point of contact for authorities**                                                                                       | DSA **Art 11**                                          | Not published                                                                              |
| **Point of contact for users** — and it may not require a phone number, but must allow direct, rapid, electronic contact   | DSA **Art 12**                                          | Not published                                                                              |
| **Terms and conditions** stating content-moderation policy in clear, plain, intelligible language                          | DSA **Art 14**                                          | **No terms exist at all**                                                                  |
| **Provider identification (Impressum)**                                                                                    | **§ 5 DDG** — replaced § 5 TMG in May 2024              | Not published. **See the flag in §5 below — it may not apply to a non-commercial service** |
| **Report suspicion of a criminal offence threatening life or safety** to authorities                                       | DSA **Art 18**                                          | No procedure. Low likelihood on a music site; the obligation does not depend on likelihood |

### 2.2 Not required, because of the micro-enterprise exclusion

**DSA Art 19 disapplies Section 3 to micro and small enterprises**, except Art 24(3). Its text: _"This Section, with the exception of Article 24(3) thereof, shall not apply to providers of online platforms that qualify as micro or small enterprises."_

So **none of these are legally required** of longplayr today:

- **Art 20** internal complaint-handling system
- **Art 21** out-of-court dispute settlement
- **Art 22** trusted flaggers
- **Art 23** measures against misuse
- **Art 24** platform transparency reporting
- **Art 25** dark-pattern interface rules
- **Art 26–27** advertising and recommender transparency
- **Art 28** protection of minors

**Art 15 transparency reports are separately excluded** for micro and small enterprises.

**The exclusion follows the enterprise, not the product.** It survives 12 months after outgrowing the threshold — under 50 staff **and** under €10m turnover — and never applies to a very large platform.

> ### ⚠️ Exempt is not the same as wise
>
> **Art 28, protection of minors, is the one to think about rather than file.** longplayr is legally excluded from it as a micro enterprise. It is also a public social product with no age gate, no minors policy, and a `sexual or violent content` report category that exists precisely because such material is foreseeable. **The exemption is about proportionate regulation, not about the risk going away.**

---

## 3. What messaging specifically adds

**Private messages are not "dissemination to the public".** DSA Recital 14 is explicit: information exchanged through interpersonal communication services such as email or private messaging is **not** disseminated to the public, and such services fall outside the _online platform_ definition.

**So messaging does not escalate longplayr's DSA tier.** It was already an online platform through its public surfaces, and it is already excluded from Section 3 by size. **Messaging changes neither.**

**What it does change is the hosting surface.** Messages are stored information provided by a recipient, so the Section 2 obligations that already apply — Art 16 and Art 17 — extend to them.

> ### 🚩 Needs professional advice
>
> **Whether Art 16 notice-and-action must cover private messages, and what that means in practice**, is the central unresolved question and the one worth paying for. A notice-and-action mechanism over private correspondence raises a confidentiality problem the public surfaces do not have: **acting on a report means a moderator reading a private message.**
>
> **This is the question §10.4 was really asking**, and it is not answerable from desk research.

**A practical consequence worth recording regardless.** §10.4's assumption that messaging needs _"the smallest safety surface that discharges the actual obligations"_ holds — and that surface turns out to be **the same Art 16 and Art 17 machinery the public product already owes.** Messaging does not need its own moderation system; it needs the one Phase 6 is already building, extended.

---

## 4. Separate from the DSA

| Regime               | Status                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GDPR**             | Applies already. Account deletion (§87) and data export (§93) serve Arts 17 and 20 — **though neither was built to a legal standard and neither has been reviewed against one**                                       |
| **TDDDG** (ex-TTDSG) | Cookie and terminal-equipment consent. longplayr sets auth cookies only, which are generally strictly necessary; **an analytics or error-tracking provider would change this** — relevant to the unbuilt Phase 7 item |
| **NetzDG**           | Largely superseded by the DSA and DDG                                                                                                                                                                                 |

---

## 5. Flagged for professional advice

**These are the items where being wrong has real consequences and desk research cannot settle it.**

> ### 🚩 Is longplayr "commercial" for § 5 DDG?
>
> The Impressum duty attaches to services offered **`geschäftsmäßig`** — habitually, usually for payment. longplayr is free, personal and has no revenue. **Whether a free hobby project with public user accounts is `geschäftsmäßig` is genuinely arguable**, and German practice has treated some non-commercial sites as caught. Getting it wrong risks an `Abmahnung`. **Cheap to comply with, expensive to be wrong about.**

> ### 🚩 Does Art 16 reach private messages, and how is it discharged without reading them?
>
> See §3. The central messaging question.

> ### 🚩 Do §87 deletion and §93 export actually satisfy GDPR Arts 17 and 20?
>
> Both were built as product features with honest engineering. **Neither was designed against the legal text**, and export format, completeness and response-time expectations are all specified in law rather than by taste.

> ### 🚩 Does hosting on Vercel and Supabase create transfer or processor obligations?
>
> Both are US-headquartered. Supabase is configured in an EU region and Resend in `eu-west-1`, which helps. **Data processing agreements and Art 28 GDPR processor terms have not been reviewed.**

---

### Does a hard account delete have to destroy moderation records? **[RAISED 2026-10-01]**

**`CLAUDE.md` requires account deletion to be a hard delete with a complete cascade**, on the stated ground that an orphaned row is a privacy failure. Phase 6 slice 3 therefore cascades `reports` and `moderation_actions` from `profiles` — `architecture.md` §16.10c.

**The consequence, stated plainly: a moderated user who deletes their account destroys the record that they were moderated, including the Art 17 statement of reasons issued to them.** A reporter who deletes their account destroys their reports.

**What needs advice.** Whether any retention duty — DSA, GDPR Art 17(3) exemptions, or German law — survives an erasure request, and if so what minimal record may be kept and for how long. **The product currently resolves this in favour of erasure**, which is the privacy-safe direction and the one that can be loosened later by decision rather than tightened by accident.

**Not blocking.** The slice ships with the cascade.

## 6. What this changes about the plan

**Messaging is no longer blocked by unknown obligations.** §10.4's precondition asked what the minimum safety layer is; **the answer is Art 16 notice-and-action plus Art 17 statements of reasons** — which Phase 6 slice 3 is already scoped to build. **One question remains open and needs a lawyer** (messages and Art 16), so the precondition is _discharged as researched, not as cleared_.

**Phase 6 slice 3 is now carrying legal weight, not just product weight.** Reporting was ranked as safety tooling. **Art 16 makes it an obligation**, and Art 17 adds a requirement nothing in the plan currently covers: **telling somebody why their content was removed.** §92 built the ability to remove; nothing tells the author.

**Three things apply today and are not in any phase**: terms and conditions (Art 14), the two points of contact (Arts 11 and 12), and provider identification (§ 5 DDG). **They are documents and a page, not engineering** — and they are the cheapest obligations here to discharge.

---

## Sources

- [Digital Services Act — full text and articles](https://www.eu-digital-services-act.com/Digital_Services_Act_Articles.html)
- [DSA Article 19 — Exclusion for micro and small enterprises](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_19.html)
- [DSA Article 15 — transparency reporting](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_15.html)
- [DSA Recital 14 — dissemination to the public and interpersonal communication](https://www.cms-digitallaws.com/en/dsa/recital-14/)
- [Das neue Digitale-Dienste-Gesetz (DDG) — eRecht24](https://www.e-recht24.de/datenschutz/13328-digitale-dienste-gesetz-ddg.html)
- [Handlungsbedarf für Website-Betreiber aufgrund des neuen DDG — HÄRTING Rechtsanwälte](https://haerting.de/wissen/handlungsbedarf-fuer-website-betreiber-aufgrund-des-neuen-digitale-dienste-gesetzes-ddg/)
- [Digital Services Act (DSA) — Bundeskriminalamt](https://www.bka.de/EN/OurTasks/Remit/CentralAgency/DigitalServicesAct/DigitalServicesAct_node.html)
- [Group chats under the DSA: when do hybrid services become online platforms? — ILP Lab](https://ilplab.nl/2025/11/28/group-chats-under-the-dsa-when-do-hybrid-services-become-online-platforms/)
