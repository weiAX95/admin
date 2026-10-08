FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/cache
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 \
  && pip install --no-cache-dir bert-score==0.3.13 \
  && python -c "from huggingface_hub import snapshot_download; snapshot_download('google-bert/bert-base-multilingual-cased', local_dir='/models/bert-base-multilingual-cased')" \
  && chmod -R a+rX /models
