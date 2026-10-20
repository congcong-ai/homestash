"""加载锁定SDK自带的protocomm protobuf；不引入网络管理器。"""
import importlib.util
import os
from pathlib import Path
import sys
folder = Path(os.environ['IDF_PATH']) / 'components/protocomm/python'
for name in ['constants_pb2', 'sec0_pb2', 'sec1_pb2', 'sec2_pb2', 'session_pb2']:
    spec = importlib.util.spec_from_file_location(name, folder / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    globals()[name] = module
