import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "isolation", Path(__file__).resolve().parents[1] / "hml-isolation.py")
iso = importlib.util.module_from_spec(spec)
spec.loader.exec_module(iso)


class IsolationTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.db = root / "data" / "funix.sqlite"
        self.db.parent.mkdir()
        self.mounts = {"/etc/nginx/nginx.conf": str(root/"nginx"),
                       "/etc/nginx/hml.htpasswd": str(root/"auth")}
        self.release = {role: "sha256:" + str(i)*64 for i, role in enumerate(sorted(iso.ROLES), 1)}
        self.release["revision"] = "a"*40
        env = {**iso.FIXED, **{key:"false" for key in iso.FLAGS},
               "FUNIX_OPERATOR_PASSWORD": "synthetic-only-password",
               "FUNIX_REVISION": self.release["revision"]}
        self.config = {"name":iso.PROJECT, "networks":{
            "private":{"name":iso.PRIVATE,"internal":True},
            "edge":{"name":iso.EDGE}}, "services":{}}
        self.records = []
        for role in sorted(iso.ROLES):
            labels = iso.LABELS.copy() if role == "gateway" else {"traefik.enable":"false"}
            binds = iso.expected_binds(role,self.db,self.mounts)
            networks = ["private","edge"] if role == "gateway" else ["private"]
            environment = env.copy() if role == "api" else {}
            service = {"read_only":True,"cap_drop":["ALL"],
                       "security_opt":["no-new-privileges:true"],"networks":networks,
                       "labels":labels,"environment":environment,
                       "volumes":[{"type":"bind","source":source,"target":target,
                                   "read_only":readonly,"bind":{"create_host_path":False}}
                                  for target,(source,readonly) in binds.items()]}
            self.config["services"][role] = service
            self.records.append({"Id":role,"Name":"/funix-hml-"+role+"-1",
                "Image":self.release[role],"State":{"Running":True},
                "Config":{"Labels":{**labels,"com.docker.compose.project":iso.PROJECT,
                                    "com.docker.compose.service":role},
                          "Env":[k+"="+v for k,v in environment.items()]},
                "HostConfig":{"ReadonlyRootfs":True,"CapDrop":["ALL"],
                              "SecurityOpt":["no-new-privileges"]},
                "NetworkSettings":{"Networks":{name:{} for name in iso.network_names(role)}},
                "Mounts":[{"Type":"bind","Source":source,"Destination":target,"RW":not readonly}
                          for target,(source,readonly) in binds.items()]})
        self.private = {"Name":iso.PRIVATE,"Driver":"bridge","Internal":True,
                        "Containers":{role:{} for role in iso.ROLES}}

    def compose(self):
        iso.compose(self.config,self.db,self.mounts,self.release["revision"])

    def runtime(self):
        iso.runtime(self.records,self.config,self.db,self.mounts,self.release,self.private)

    def test_expected_configuration_and_runtime(self):
        self.compose()
        self.runtime()

    def test_unsafe_config_is_not_authorized_by_an_equal_contract(self):
        for patch in ({"privileged":True},{"cap_add":["SYS_ADMIN"]},{"ports":["8787:8787"]},
                      {"pid":"host"},{"cap_drop":[]},{"security_opt":[]},{"extra_hosts":["x:1.2.3.4"]},
                      {"tmpfs":["/etc"]}):
            with self.subTest(patch=patch):
                old = copy.deepcopy(self.config)
                self.config["services"]["api"].update(patch)
                with self.assertRaises(ValueError):
                    self.compose()
                self.config = old

    def test_external_credentials_and_enabled_features(self):
        env = self.config["services"]["api"]["environment"]
        for key,value in (("CODA_API_TOKEN","synthetic"),("HTTPS_PROXY","https://example.invalid"),
                          ("FUNIX_QUOTE_ENABLED","true"),("FUNIX_QUOTE_DISCOVERY_V2","true"),
                          ("FUNIX_NEW_NOT_REVIEWED","nonempty")):
            with self.subTest(key=key):
                old=env.copy()
                env[key]=value
                with self.assertRaises(ValueError):
                    self.compose()
                env.clear()
                env.update(old)
        env.pop("FUNIX_EVOLUTION_READ_ENABLED")
        with self.assertRaises(ValueError):
            self.compose()

    def test_other_data_directory_and_gateway_route_block(self):
        mount = self.config["services"]["api"]["volumes"][0]
        old = mount["source"]
        mount["source"] = "/var/lib/funix/app-data"
        with self.assertRaises(ValueError):
            self.compose()
        mount["source"] = old
        self.config["services"]["gateway"]["labels"]["traefik.http.routers.funix-hml.rule"] = "Host(\x60app.funix.com.br\x60)"
        with self.assertRaises(ValueError):
            self.compose()

    def test_live_drift_and_extra_private_member(self):
        for key,value in (("Privileged",True),("PublishAllPorts",True),("CapAdd",["NET_ADMIN"]),
                          ("ReadonlyRootfs",False),("PidMode","host")):
            with self.subTest(key=key):
                host=self.records[0]["HostConfig"]
                old=host.copy()
                host[key]=value
                with self.assertRaises(ValueError):
                    self.runtime()
                host.clear()
                host.update(old)
        self.private["Containers"]["unrelated"]= {}
        with self.assertRaises(ValueError):
            self.runtime()

    def test_live_injected_credentials_block(self):
        api=next(item for item in self.records if item["Id"]=="api")
        api["Config"]["Env"].append("OPENAI_API_KEY=synthetic")
        with self.assertRaises(ValueError):
            self.runtime()

    def test_live_mount_and_image_mismatch_block(self):
        api=next(item for item in self.records if item["Id"]=="api")
        mount=api["Mounts"][0]
        old=mount["Source"]
        mount["Source"]="/var/lib/funix/app-data"
        with self.assertRaises(ValueError):
            self.runtime()
        mount["Source"]=old
        api["Image"]="unexpected"
        with self.assertRaises(ValueError):
            self.runtime()
