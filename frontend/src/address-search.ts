import {
  Component,
  OnDestroy,
  input,
  output,
  signal,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Subscription } from "rxjs";
export interface AddressResult {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
}
export interface AddressAction {
  kind: "select" | "event" | "object" | "use" | "clear";
  result: AddressResult | null;
}
@Component({
  selector: "vv-address-search",
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="address-search" aria-label="Address search">
      <div class="address-input-row">
        <input
          aria-label="Search Estonian addresses"
          placeholder="Search Estonian addresses…"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="address-results"
          [attr.aria-expanded]="results().length > 0"
          [attr.aria-activedescendant]="
            active >= 0 ? 'address-option-' + active : null
          "
          [ngModel]="query()"
          (ngModelChange)="search($event)"
          (keydown)="key($event)"
          maxlength="160"
          autocomplete="off"
        />
        @if (query()) {
          <button
            type="button"
            aria-label="Clear address search"
            (click)="clear()"
          >
            ×
          </button>
        }
      </div>
      @if (busy()) {
        <p role="status">Searching addresses…</p>
      }
      @if (error()) {
        <p role="alert">
          {{ error() }}
          <button type="button" (click)="search(query())">Retry</button>
        </p>
      }
      @if (noResults()) {
        <p role="status">
          No matching address. Try a street, house number and town.
        </p>
      }
      @if (results().length) {
        <div
          id="address-results"
          role="listbox"
          aria-label="Address suggestions"
        >
          @for (result of results(); track result.id; let i = $index) {
            <button
              type="button"
              role="option"
              [id]="'address-option-' + i"
              [attr.aria-selected]="active === i"
              (click)="choose(result)"
            >
              {{ result.label }}
            </button>
          }
        </div>
      }
      @if (picked(); as result) {
        <div class="address-picked">
          <strong>{{ result.label }}</strong>
          @if (editing()) {
            <button type="button" [disabled]="disabled()" (click)="act('use')">
              {{
                locationMode() === "vertex"
                  ? "Move selected boundary point here"
                  : locationMode() === "draw"
                    ? "Add drawing point here"
                    : "Use this location"
              }}
            </button>
          } @else {
            <button
              type="button"
              [disabled]="disabled()"
              (click)="act('event')"
            >
              Create event here
            </button>
            <button
              type="button"
              [disabled]="disabled()"
              (click)="act('object')"
            >
              Create object here
            </button>
          }
        </div>
      }
      @if (query().length >= 3) {
        <small
          >Addresses:
          <a
            href="https://geoportaal.maaamet.ee/est/teenused/integreeritav-aadressiotsing-in-ads-p504.html"
            target="_blank"
            rel="noopener noreferrer"
            >Maa- ja Ruumiamet</a
          ></small
        >
      }
    </section>
  `,
})
export class AddressSearch implements OnDestroy {
  private http = inject(HttpClient);
  editing = input(false);
  disabled = input(false);
  locationMode = input<"point" | "vertex" | "draw">("point");
  action = output<AddressAction>();
  query = signal("");
  results = signal<AddressResult[]>([]);
  picked = signal<AddressResult | null>(null);
  busy = signal(false);
  error = signal("");
  noResults = signal(false);
  active = -1;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: Subscription;
  private sequence = 0;
  search(value: string) {
    const sequence = ++this.sequence;
    clearTimeout(this.timer);
    this.request?.unsubscribe();
    this.query.set(value);
    this.results.set([]);
    this.picked.set(null);
    this.active = -1;
    this.error.set("");
    this.noResults.set(false);
    this.busy.set(false);
    this.action.emit({ kind: "clear", result: null });
    if (value.trim().length < 3) return;
    this.busy.set(true);
    this.timer = setTimeout(() => {
      this.request = this.http
        .get<AddressResult[]>("/api/addresses", { params: { q: value.trim() } })
        .subscribe({
          next: (results) => {
            if (sequence !== this.sequence) return;
            this.busy.set(false);
            this.results.set(results);
            this.noResults.set(results.length === 0);
          },
          error: (error: HttpErrorResponse) => {
            if (sequence !== this.sequence) return;
            this.busy.set(false);
            this.error.set(
              error.error?.detail ??
                "Address search is unavailable. Try again or choose a location on the map.",
            );
          },
        });
    }, 400);
  }
  choose(result: AddressResult) {
    ++this.sequence;
    clearTimeout(this.timer);
    this.request?.unsubscribe();
    this.busy.set(false);
    this.query.set(result.label);
    this.results.set([]);
    this.active = -1;
    this.picked.set(result);
    this.action.emit({ kind: "select", result });
  }
  act(kind: "event" | "object" | "use") {
    if (!this.disabled()) this.action.emit({ kind, result: this.picked() });
  }
  clear() {
    this.search("");
  }
  key(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      this.clear();
      return;
    }
    const n = this.results().length;
    if (!n) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.active =
        this.active < 0
          ? event.key === "ArrowDown"
            ? 0
            : n - 1
          : (this.active + (event.key === "ArrowDown" ? 1 : -1) + n) % n;
      setTimeout(() =>
        document
          .getElementById("address-option-" + this.active)
          ?.scrollIntoView({ block: "nearest" }),
      );
    } else if (event.key === "Enter" && this.active >= 0) {
      event.preventDefault();
      this.choose(this.results()[this.active]);
    }
  }
  ngOnDestroy() {
    ++this.sequence;
    clearTimeout(this.timer);
    this.request?.unsubscribe();
  }
}
