import { Router } from "express";
import { BaseController } from "./BaseController";

export class RouterRegistry {
  private router: Router;
  private controllers: BaseController[];

  constructor(controllers: BaseController[]) {
    this.router = Router();
    this.controllers = controllers;
  }

  /**
   * Register all controllers and return the populated Router
   */
  public registerAll(): Router {
    for (const controller of this.controllers) {
      controller.register(this.router);
    }
    return this.router;
  }
}
