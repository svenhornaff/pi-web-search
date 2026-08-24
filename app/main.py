from __future__ import annotations

import logging

from flask import Flask

from app.blueprints.web import bp as web_bp

logger = logging.getLogger(__name__)


def create_app() -> Flask:
    """Minimal application factory."""
    app = Flask(__name__, template_folder="blueprints/web/templates")

    app.config.update(
        SECRET_KEY="dev-secret",
        DEBUG=True,
    )

    app.register_blueprint(web_bp)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}, 200

    return app
