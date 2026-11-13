## ADDED Requirements

### Requirement: Unavailable thermal queries have bounded retry frequency
After the thermal provider becomes available, an unsuccessful temperature query SHALL be cached for five seconds, as a successful result is. The absence of a provider SHALL NOT delay the first query after connection.

#### Scenario: Thermal class is unavailable
- **WHEN** connected thermal queries return no usable value on repeated 250 ms ticks
- **THEN** no more than one query runs in each five-second cache interval and no temperature is fabricated

#### Scenario: WMI connects after core startup
- **WHEN** early ticks have no thermal connection and a connection later becomes available
- **THEN** the next eligible poll queries immediately

### Requirement: Disconnected interfaces stop contributing network deltas
Network aggregation SHALL remove interfaces absent from the successful current interface enumeration, so previously observed byte deltas cannot be replayed after disconnection. A newly observed or reconnected interface SHALL establish its baseline before contributing a rate.

#### Scenario: Active network adapter disappears
- **WHEN** an interface with a nonzero previous byte delta is absent from the next enumeration
- **THEN** later network rates exclude its stale delta
