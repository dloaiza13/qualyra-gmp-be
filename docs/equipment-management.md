# Equipment, calibration, and maintenance

Qualyra treats equipment fitness for use as a derived, tenant-isolated control. An active item is approved for use only while every required calibration and maintenance plan is current and no signed intervention is awaiting independent review.

## Permissions

| Permission            | Scope                                                      |
| --------------------- | ---------------------------------------------------------- |
| `equipment.read`      | Read the equipment register and signed service history     |
| `equipment.create`    | Register immutable equipment master data and service plans |
| `equipment.calibrate` | Complete and sign calibrations as the assigned owner       |
| `equipment.maintain`  | Complete and sign maintenance as the assigned owner        |
| `equipment.verify`    | Independently accept or reject signed service records      |
| `equipment.retire`    | Independently sign the permanent retirement of an item     |

The assigned owner and verifier must be different active users. The service verifies their permissions again when the master record is created.

## API

| Method | Route                                                        | Permission            | Purpose                                   |
| ------ | ------------------------------------------------------------ | --------------------- | ----------------------------------------- |
| `GET`  | `/equipment`                                                 | `equipment.read`      | List and filter tenant equipment          |
| `GET`  | `/equipment/participants`                                    | `equipment.create`    | List active eligible participants         |
| `GET`  | `/equipment/:equipmentId`                                    | `equipment.read`      | Read master data and full signed history  |
| `POST` | `/equipment`                                                 | `equipment.create`    | Register controlled master data           |
| `POST` | `/equipment/:equipmentId/calibrations`                       | `equipment.calibrate` | Sign a calibration result                 |
| `POST` | `/equipment/:equipmentId/calibrations/:calibrationId/review` | `equipment.verify`    | Sign the independent calibration review   |
| `POST` | `/equipment/:equipmentId/maintenances`                       | `equipment.maintain`  | Sign preventive or corrective maintenance |
| `POST` | `/equipment/:equipmentId/maintenances/:maintenanceId/review` | `equipment.verify`    | Sign the independent maintenance review   |
| `POST` | `/equipment/:equipmentId/retirement`                         | `equipment.retire`    | Sign permanent retirement                 |

## Fitness-for-use rules

- Equipment codes use the tenant-scoped sequence `EQP-YYYY-NNNN`.
- Controlled master data, responsible users, and plan intervals are immutable after registration.
- Starting calibration or maintenance places the equipment out of service immediately.
- A passing or satisfactory result restores service only after acceptance by the assigned independent verifier.
- Failed, unsatisfactory, or rejected work remains out of service.
- An overdue required plan makes an otherwise active item unfit for use.
- Only one calibration and one maintenance cycle may await review at a time.
- Retirement is terminal and preserves every record.

## Electronic records and tenancy

Calibration, maintenance, their reviews, and retirement require password reauthentication and explicit attestation. Each record stores its signature meaning, authentication method, timestamp, signer, and SHA-256 record hash. Database triggers reject changes to signed tuples and enforce independent review.

PostgreSQL row-level security is forced on the equipment master, sequence, calibration, maintenance, and review tables. Runtime access is tenant-scoped, and the application role has no delete privilege for these records. Security events record registration, completed work, independent reviews, retirement, and failed reauthentication.

## Verification

`test/equipment.integration-spec.ts` exercises organization isolation, role permissions, failed reauthentication, signed calibration and maintenance cycles, independent acceptance, derived fitness for use, hash retention, and retirement. `test/rls.integration-spec.ts` covers the new tables in the runtime RLS inventory.
