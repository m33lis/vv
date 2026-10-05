import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient } from "@angular/common/http";
import { App } from "./app";
bootstrapApplication(App, { providers: [provideHttpClient()] }).catch(
  console.error,
);
