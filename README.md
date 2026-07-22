# @frxnklyn/transaction-manager

Ein generischer Transaction Manager für Domain-Objekte. Änderungen werden
sofort im Speicher ausgeführt. Eine Transaction erfasst ausschließlich die
bereits ausgeführten Änderungen für einen möglichen Rollback und schiebt die
Persistierung bis zu `submit()` auf.

## Kernverträge

- `TransactionParticipantInterface` besitzt `update()`, verwaltet seinen
  `UpdaterInterface` und kann einen `TransactionOperationRegistrarInterface`
  attachen beziehungsweise detachen.
- `UpdaterInterface` enthält nur den bestehenden Autoupdate- und
  Tracked-File-Vertrag. Es besitzt bewusst keine `update()`-Methode.
- `TransactionOperationRegistrarInterface` stellt ausschließlich
  `registerOperation()` bereit.
- `TransactionOperationInterface` beschreibt eine bereits ausgeführte Änderung
  mit Participant, Diagnose-Name und Rollback-Funktion.
- `TransactionCommitStrategyInterface` entscheidet, wie oft und in welcher
  Reihenfolge `participant.update()` während `submit()` aufgerufen wird.
  Erfolgreich persistierte Operationen entfernt sie über
  `TransactionOperationCleanupInterface`.

## Architektur

```mermaid
classDiagram
    direction LR

    class TransactionOperationRegistrarInterface {
        <<interface>>
        +registerOperation(operation) void
    }

    class TransactionInterface {
        <<interface>>
        +getState() TransactionState
        +start(participants?) void
        +attach(participants) this
        +submit() Promise~void~
        +rollback() Promise~void~
        +stop() Promise~void~
        +pause() Promise~void~
        +detach(participants?) void
    }

    class AbstractTransaction {
        <<abstract>>
        -bindings Map
        -operations TransactionOperationInterface[]
        -stateMachine TransactionStateMachine
        -commitStrategy TransactionCommitStrategyInterface
    }

    class Transaction {
        +commit() Promise~void~
    }

    class TransactionParticipantInterface {
        <<interface>>
        +update() Promise~void~
        +getUpdater() UpdaterInterface
        +setUpdater(updater) void
        +attachTransaction(registrar) void
        +detachTransaction(registrar) void
    }

    class UpdaterInterface {
        <<interface>>
        +shouldUpdate() boolean
        +getIsAutoupdate() boolean
    }

    class DisabledUpdater {
        +shouldUpdate() boolean
    }

    class TransactionOperationInterface {
        <<interface>>
        +name string
        +participant TransactionParticipantInterface
        +rollback() Promise~void~
    }

    class TransactionCommitStrategyInterface {
        <<interface>>
        +commit(participants, operations, cleanup) Promise~void~
    }

    class TransactionOperationCleanupInterface {
        <<interface>>
        +removeOperation(operation) void
    }

    class PerParticipantTransactionCommitStrategy
    class PerOperationTransactionCommitStrategy
    class TransactionStateMachine

    TransactionInterface --|> TransactionOperationRegistrarInterface
    AbstractTransaction ..|> TransactionInterface
    Transaction --|> AbstractTransaction
    TransactionParticipantInterface --> UpdaterInterface : owns
    TransactionParticipantInterface --> TransactionOperationRegistrarInterface : reports operations
    AbstractTransaction o-- TransactionParticipantInterface : bindings
    AbstractTransaction o-- TransactionOperationInterface : undo log
    AbstractTransaction --> TransactionStateMachine : lifecycle
    AbstractTransaction --> TransactionCommitStrategyInterface : submit delegates
    TransactionCommitStrategyInterface --> TransactionOperationCleanupInterface : removes persisted operations
    Transaction --> DisabledUpdater : installs after start()
    PerParticipantTransactionCommitStrategy ..|> TransactionCommitStrategyInterface
    PerOperationTransactionCommitStrategy ..|> TransactionCommitStrategyInterface
    TransactionCommitStrategyInterface --> TransactionParticipantInterface : calls update()
```

Der Participant führt Änderungen sofort aus und registriert anschließend nur
die Gegenoperation. Nach `start()` verhindert der `DisabledUpdater` während
`Initialized` die automatische Persistierung. `submit()` und `rollback()` schalten
vor ihrer Arbeit kurz auf den festen `EnabledUpdater` und setzen danach wieder den
gestarteten Zustand mit `DisabledUpdater`.

## Verwendung

```ts
import {
  Transaction,
  TransactionOperation,
  type TransactionOperationRegistrarInterface,
  type TransactionParticipantInterface,
  type UpdaterInterface,
} from "@frxnklyn/transaction-manager";

class Participant implements TransactionParticipantInterface {
  private transaction: TransactionOperationRegistrarInterface | undefined;

  constructor(
    private updater: UpdaterInterface,
    private value = "",
  ) {}

  update(): void | Promise<void> {
    // Persistiert den aktuellen Participant-Zustand, sofern der installierte
    // Updater dies zulässt.
  }

  getUpdater(): UpdaterInterface {
    return this.updater;
  }

  setUpdater(updater: UpdaterInterface): void {
    this.updater = updater;
  }

  attachTransaction(
    transaction: TransactionOperationRegistrarInterface,
  ): void {
    this.transaction = transaction;
  }

  detachTransaction(
    transaction: TransactionOperationRegistrarInterface,
  ): void {
    if (this.transaction !== transaction) {
      throw new Error("Unexpected transaction registrar.");
    }

    this.transaction = undefined;
  }

  async setValue(nextValue: string): Promise<void> {
    const previousValue = this.value;
    this.value = nextValue;

    if (this.transaction !== undefined) {
      this.transaction.registerOperation(
        new TransactionOperation("setValue", this, () => {
          this.value = previousValue;
        }),
      );
    }

    await this.update();
  }
}

const transaction = new Transaction();
transaction.attach(participantA).attach(participantB);
transaction.start();

await participantA.setValue("next");
await transaction.submit();
```

`start()` akzeptiert einen einzelnen Participant oder ein readonly Array. Die
Transaction befindet sich ab ihrer Erzeugung im Wartezustand `Pending`.
`attach()` merkt Participants nur vor. `start()` wechselt nach `Initialized`, hängt die
vorgemerkten Participants an und installiert die temporären Updater.
Wird `attach()` während `Initialized` oder `Running` aufgerufen, wird der neue
Participant sofort attached und erhält den festen `EnabledUpdater`.

## Temporärer Updater

`Transaction` installiert beim Start einen festen `DisabledUpdater`. Er meldet
über den vorhandenen Updater-Vertrag, dass kein automatisches Update stattfinden
soll. Persistenzlogik bleibt im Participant. Für `submit()` und `rollback()` wird
kurz ein fester `EnabledUpdater` installiert, weil die Transaction nicht wissen
muss, welches Verhalten der ursprüngliche Updater intern hat. Nach erfolgreichem
`submit()` oder `rollback()` wird wieder der feste `DisabledUpdater` installiert.
`stop()` stellt den ursprünglichen Updater wieder her.

## Commit-Strategien

- `PerParticipantTransactionCommitStrategy` ruft `update()` einmal pro
  angehängtem Participant in Attachment-Reihenfolge auf. Dies ist der Standard.
- `PerOperationTransactionCommitStrategy` ruft `update()` einmal pro
  registrierter Operation in Registrierungsreihenfolge auf.

Die Operationen werden beim Commit nie erneut ausgeführt. Beide Strategien
erhalten eingefrorene Snapshots der Participant- und Operation-Arrays, nachdem
alle Participants den festen `EnabledUpdater` erhalten haben. Die Strategies
entfernen erfolgreich persistierte Operationen über das Cleanup-Interface,
damit ein späterer Fehler nur noch nicht persistierte Operationen für Rollback
übrig lässt.

## Lifecycle

- `submit()`: festen `EnabledUpdater` installieren, Commit-Strategie ausführen,
  erledigte Operationen aus dem Undo-Log entfernen, Participants attached lassen,
  kurz zu `Committed` wechseln, danach über `Pending` zurück nach `Initialized`
  wechseln und den festen `DisabledUpdater` installieren.
- `rollback()`: Operationen in umgekehrter Reihenfolge zurückrollen,
  erfolgreich zurückgerollte Operationen aus dem Undo-Log entfernen, Participants
  attached lassen, kurz zu `RolledBack` wechseln, danach über `Pending` zurück
  nach `Initialized` wechseln und den festen `DisabledUpdater` installieren.
- `stop()`: weder persistieren noch zurückrollen, sondern Original-Updater
  wiederherstellen, alle offenen Operationen verwerfen, Participants attached
  lassen, kurz zu `Stopped` wechseln und nach `Pending` zurückkehren. Der
  Speicherzustand bleibt erhalten.
- `pause()`: wie `stop()`, aber ohne `Stopped`-Zwischenzustand: Original-Updater
  wiederherstellen, alle offenen Operationen verwerfen und nach `Pending`
  wechseln.
- `detach()`: einen, mehrere oder alle Participants explizit von der Transaction
  lösen. Dabei läuft derselbe Cleanup-Pfad wie bei Setup-Fehlern: Original-Updater
  restaurieren, Registrar detachen, keine erneute Persistierung. Participants mit
  noch registrierten Operationen können nicht detached werden.

Verwendete States:

```text
Pending -> Initialized
Initialized -> Running | Committing | RollingBack | Stopping | Pausing | Failed
Running -> Running | Initialized | Committing | RollingBack | Stopping | Pausing | Failed
Committing -> Committed | Failed
Committed -> Pending | Initialized
RollingBack -> RolledBack | Failed
RolledBack -> Pending | Initialized
Stopping -> Stopped | Failed
Stopped -> Pending
Pausing -> Pending | Failed
Failed -> Pending | RollingBack | Stopping | Pausing
```

`Failed` kann für manuelle Fehlerbehandlung zurück nach `Pending` geführt werden
oder einen erneuten Rollback-Versuch starten.

## Entwicklung

```sh
npm run build
npm test
```
