# Financial Engine Reference

Every formula implemented in `src/lib/domain/`, with its symbol table, its defaults
and the test that pins it. Nothing here is advisory — these are the exact
expressions evaluated at runtime.

## 0. Units

| Symbol | Meaning | Value |
| --- | --- | --- |
| `HEMMAT_RIAL` | 1 Hemmat (همت) | 10¹³ Rial |
| `TOMAN_RIAL` | 1 Toman | 10 Rial |
| `BILLION_TOMAN_RIAL` | 1 میلیارد تومان | 10¹⁰ Rial |
| `DAYS_PER_MONTH` | Iranian banking month | 30 |

Reported aggregates use **میلیارد تومان (B Toman = 10¹⁰ Rial)** and **Hemmat**.

## 1. Cost of funds — `costOfFunds.ts`

```text
CoF_m        = ( r_d,m − RR_m · r_CB_reward ) / ( 1 − RR_m + LR_m ) + θ_OpEx + θ_EL,m
θ_EL,m       = PD_m × LGD_m
```

| Parameter | Default | Notes |
| --- | --- | --- |
| `RR_m` statutory reserve | QH/current **0.02** · short-term **0.10** · long-term **0.15** · participation & Gam **0.00** | `STATUTORY_RESERVE` |
| `r_CB_reward` | 0.01 | reward paid on the blocked reserve |
| `LR_m` liquidity deduction | 0.01 | vault + ATM cash needs |
| `θ_OpEx` | 0.035 | admin cost over free resources |

Inverse helper: `depositRateForTargetCoF(target, input)` returns the `r_d,m` that
reproduces a given all-in cost. Pinned by `U-COF-01` / `U-COF-02`.

Worked example pinned in the suite (RR = 0.15, LR = 0.01, r_d = 0.18, PD = 0.03, LGD = 0.35):

```text
CoF = (0.18 − 0.15×0.01)/(1 − 0.15 + 0.01) + 0.035 + 0.0105 = 0.253058
```

## 2. Point engine — `pointEngine.ts`

### Weighted average balance

```text
B̄_m = (1 / N_d) Σ_{t=1..N_d} B_m,t · κ_source ,      N_d = 30 · τ_d,m
```

`κ_source`: standard retail **1.0** · POS/IPG merchant settlement float **1.5** ·
corporate payroll float **1.3**. The cohort ramps to full balance over
`min(3, τ_d)` months by default.

### Loan entitlement

```text
L_m = α_m · B̄_m      subject to L_max,m (per-customer ceiling × customer count)
```

### Blocked-fraction release — `blockedReleaseSchedule`

| Schedule | Behaviour |
| --- | --- |
| `linear` | `β·B̄ / τ_l` released with every instalment |
| `midpoint` | entire block released at instalment `⌈τ_l/2⌉` (50% completion) |
| `end` | released at the final instalment |

Pinned by `U-POINT-02` (sums to the blocked amount) and `U-POINT-03` (midpoint index).

### Actuarial equivalence (NPV of the bank)

```text
NPV_bank,m = Σ_{t=1..τ_d}  B̄(1−RR)(r_treasury − CoF_m) / (1 + r_h/12)^t
           − L_m (1 − γ_m − β_m)
           + Σ_{k=1..τ_l} [ PMT(r_l/12, τ_l, L_m) − Release_k(β_m·B̄) ] / (1 + r_h/12)^(τ_d + ω_m + k)  ≥ 0
```

`r_h` hurdle = interbank 0.23 + margin 0.02 = **0.25** · `r_treasury` = **0.245**.

### Inverse rate solver — `solveBreakEvenLoanRate`

Bisection over `[minRate, maxRate]` for the smallest contract rate whose NPV is
non-negative. Returns `breakEvenFound: false` when even the ceiling cannot
rescue the structure (an automatic redesign signal).

### Affordability — `installmentAffordability`

```text
PMT = L·i / (1 − (1+i)^−n) ,   i = r_l/12
PMT / income ≤ 0.40
maxAffordableLoan = income × 0.40 × (1 − (1+i)^−n) / i
```

## 3. ALM digital twin — `almSimulator.ts`

### Cohort lifecycle

| Phase | Entry | Exit |
| --- | --- | --- |
| 0 sleeping | cohort intake `D_m,t` | `age ≥ τ_d` |
| 1 queued | — | `age ≥ τ_d + ω` |
| 2 repaying | disbursement | loan amortised or horizon end |
| 3 closed | — | 38% rolls into a fresh cycle |

At disbursement:

```text
loan          = α_m · cohort_volume      (capped by per-customer ceiling)
withdrawable  = volume · (1 − β_m)
leak          = withdrawable · δ_m ,     δ_m ~ Beta(δ̄·k, (1−δ̄)·k),  k = 12
blocked       = volume · β_m             → released per schedule
closedLoop    = loan · γ_m               → merchant float bucket (3-month life)
```

### Monthly aggregates

```text
LDR(t) = loans(t) / [ deposits(t) · (1 − RR_weighted) ]
LCR(t) = [ HQLA(t) + net inflows_30d ] / stressed_outflows_30d(t)
stressed_outflows_30d = 0.09 · hotDeposits · scenario_outflow + 0.25 · blockedReleased
reversal(t) = max(0, withdrawals(t) − closedLoopInflow(t)) / deposits(t−1)     ← واژگونی
```

Treasury deployment is capacity-limited (`treasuryCapacityRatio = 0.28` of the
deposit book): idle surplus beyond market absorption earns nothing, and any
funding gap is financed at interbank + 120 bp.

### Income statement split

| Line | Classification |
| --- | --- |
| Loan interest / Morabaha profit | مشاع (joint) |
| Treasury & interbank placement, HQLA yield | مشاع (joint) |
| QH commission, acquirer interchange, origination fee | غیرمشاع (non-joint) |
| Deposit profit share, opex, expected loss, wholesale funding cost | expense |

### Reported metrics

`irrBank` (monthly), `irrBankAnnual = (1+irr)^12 − 1`, `roi`, `roe`, `nim`,
`nimJoint`, `nimNonJoint`, `p95Ldr`, `p5Lcr`, `meanLdr`, `meanLcr`,
`overturningShock` (p95 of the per-path maximum), `netLiquidityDrainRatio`
(net disbursement leakage ÷ total originations), `resourceStabilityIndex`,
`monthsInBreachLdr/Lcr`, `economicCapitalRial`.

Economic capital:

```text
EC = 0.10 · peakLoans + 0.12 · peakDeposits + 0.0012 · attractedResources
```

### Solvency rules

```text
p95_t LDR(t)  ≤ 0.85
p5_t  LCR(t)  ≥ 1.05
internal warning trigger: LDR > 0.80
```

### Scenarios

| Scenario | outflow | adoption | δ | rate |
| --- | --- | --- | --- | --- |
| `base` | 1.00 | 1.00 | 1.00 | 1.00 |
| `mild-rate-shock` | 1.25 | 0.94 | 1.15 | 1.06 |
| `severe-run` | 1.85 | 0.82 | 1.45 | 1.12 |

## 4. Inverse optimiser — `optimizer.ts`

### Objective

```text
max_X  λ₁·IRR_bank(X) + λ₂·AdoptionScore(X)
       − λ₃·max_t( max(0, LDR(t) − 0.80)² )·12
       − λ₄·OverturningShock(X)·6
       − 0.08·netDrainRatio
       + 0.05·NIM
       − 0.55·max(0, IRR_target − IRR)
       − 1.6·max(0, p95LDR − 0.85)·8 − 1.4·max(0, 1.05 − p5LCR)
```

Default `λ = (0.42, 0.26, 0.22, 0.10)`, re-weighted by detected strategic emphasis
and re-normalised to sum to 1 (`intentParser.ts`).

### Constraint set

```text
Σ_m D_m = D_target
r_l ≤ 0.04 (QH) | ≤ 0.23 (Morabaha/Mudaraba/Joalah/Kharid-e-Deyn) | ≤ 0.287 (absolute)
capToman ≤ 5×10⁹ (Tamin-Yar productive credit)
PMT / persona income ≤ 0.40
blockedRatio ≤ 0.55
NPV_bank,m ≥ 0
p95 LDR ≤ 0.85 , p5 LCR ≥ 1.05
```

### Stage B — LP water-filling (`allocateWeights`)

Proportional allocation against per-archetype `capacityShare` caps, iterated until
the residual is exhausted; the result is normalised so `Σw = 1` exactly (pinned by
`U-OPT-01`).

### Stage D — critic directives

| Breach | Directive |
| --- | --- |
| p95 LDR > ceiling | β↑ +0.07, γ↑ +0.06, ω↑ +1, α↓ −0.08 |
| p5 LCR < floor | α↓ −0.09, τ_d staggering |
| IRR < target | r_l↑ +0.008 within the ceiling, fee↑ +0.0015, γ↑ +0.05, r_d↓ −0.004 |
| Overturning > tolerance | stagger τ_d across modes by 2 months, alternate release schedules, ramp↑ +2 |
| PMT/income > 0.40 | τ_l↑ +6, per-customer cap ×0.88 |
| NPV < 0 | α ×0.94 (warning severity) |

Maximum 5 iterations (`REGULATORY.maxCriticIterations`).

## 5. Mode archetypes — bounded blueprints

| Archetype | RR | r_d | r_l | τ_d | τ_l | α | β | γ | κ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `retail-qarz-average` | 0.02 | 0.000–0.005 | 0.02–0.04 | 3–12 | 12–60 | 0.80–1.70 | 0.05–0.40 | 0.15–0.72 | 1.0 |
| `investment-deposit` | 0.10–0.15 | 0.14–0.205 | 0.18–0.23 | 1–6 | 12–60 | 0.55–1.05 | 0.00–0.18 | 0.10–0.68 | 1.0 |
| `merchant-pos-accelerator` | 0.02 | 0.005–0.02 | 0.03–0.18 | 2–6 | 6–36 | 1.00–2.40 | 0.03–0.25 | 0.45–0.92 | 1.5 |
| `corporate-float-anchor` | 0.02–0.10 | 0.02–0.06 | 0.04–0.23 | 2–5 | 18–60 | 0.70–1.50 | 0.00–0.20 | 0.50–0.90 | 1.3 |
| `supply-chain-gam` | 0.00 | 0.00–0.02 | 0.06–0.19 | 1–4 | 6–24 | 0.90–2.00 | 0.00–0.12 | 0.60–0.95 | 1.4 |

Every blueprint also bounds PD, LGD, fee income, per-customer ceiling and the
customer-adoption score.

## 6. Numerical primitives — `financial.ts`

| Function | Algorithm |
| --- | --- |
| `createRng` | mulberry32, 32-bit |
| `sampleNormal` | Box–Muller |
| `sampleGamma` | Marsaglia–Tsang (shape < 1 boosted) |
| `sampleBeta` | ratio of two gamma variates |
| `pmt` | `numpy_financial.pmt` |
| `npv` | `numpy_financial.npv`, first flow at t = 0 |
| `irr` | Newton polish seeded from 0.02, bracketed bisection fallback |
| `percentile` | linear interpolation (`numpy.percentile`) |
| `seedFromString` | FNV-1a 32-bit |
