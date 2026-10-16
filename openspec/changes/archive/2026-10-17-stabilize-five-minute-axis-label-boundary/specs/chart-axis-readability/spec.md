# chart-axis-readability Specification

## Purpose

Makes the time scale on a live metric chart readable: tick text and the axis stroke clear their contrast floors, and tick labels neither overlap nor clip as the visible span grows.

## MODIFIED Requirements

### Requirement: Label precision follows the visible span

A time-axis label SHALL include seconds when the chart's visible span is at most five minutes, and SHALL NOT include a seconds field when the visible span is longer than five minutes. Labels SHALL use local time in a fixed `HH:MM` or `HH:MM:SS` form, so width does not depend on locale or a 12-hour marker. A span of at most five minutes includes a chart with a single sample.

The boundary is inclusive on the seconds side: a visible span of exactly five minutes keeps its seconds field. A five-minute (300 s) history window can produce a visible span of exactly five minutes whenever its oldest included sample lands exactly on the window cutoff, and label precision SHALL NOT depend on where the sample spacing places that boundary.

#### Scenario: A short span keeps seconds
- **WHEN** a chart's visible span is at most five minutes (including a single sample)
- **THEN** each time-axis label includes the hour, the minute, and the second

#### Scenario: A full five-minute window keeps a stable format
- **WHEN** the five-minute history window is full of samples, so its visible span can reach exactly five minutes
- **THEN** each time-axis label still includes the hour, the minute, and the second, regardless of where the window's oldest sample falls relative to the window cutoff

#### Scenario: A long span drops seconds
- **WHEN** a chart's visible span is longer than five minutes
- **THEN** each time-axis label includes the hour and the minute and does not include a seconds field
