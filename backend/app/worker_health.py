from fastapi import FastAPI
app = FastAPI()

@app.get("/")
def root():
    return {"ok": True, "service": "worker"}

@app.get("/health")
def health():
    return {"ok": True}
