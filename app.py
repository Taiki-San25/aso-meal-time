from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).parent
app = FastAPI(title="阿蘇 喫食時間管理表")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")

PAGES = {"dinner", "breakfast", "admin"}


@app.get("/")
def root():
    return RedirectResponse("/dinner")


@app.get("/api/me")
def me():
    # 認証実装までの仮値
    return {"name": "ゲスト"}


@app.get("/logout")
def logout():
    # 認証実装までの仮動作
    return RedirectResponse("/")


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/{page}")
def page(page: str):
    if page not in PAGES:
        return RedirectResponse("/dinner")
    return FileResponse(BASE / "pages" / f"{page}.html")
