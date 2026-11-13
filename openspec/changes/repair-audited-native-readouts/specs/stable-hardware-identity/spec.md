## ADDED Requirements

### Requirement: Profile and ordering share conservative GPU classification
The same adapter caption SHALL receive the same integrated/discrete/unknown classification in hardware profiles and ordering. A vendor name or ambiguous Arc brand alone SHALL NOT establish a form factor. Known discrete model families and explicit integrated/discrete metadata SHALL remain distinguishable.

#### Scenario: Intel discrete and AMD integrated adapters coexist
- **WHEN** an Intel Arc A770 and AMD Radeon Graphics adapter are classified
- **THEN** the Intel model is discrete and the AMD model is integrated in both profile and ordering

#### Scenario: Arc form factor is ambiguous
- **WHEN** a caption identifies Arc without a recognized discrete model or explicit form-factor marker
- **THEN** it remains unknown rather than being confidently classified as discrete
