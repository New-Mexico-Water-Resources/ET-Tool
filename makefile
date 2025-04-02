.ONESHELL:
SHELL=bash
VERSION := $(shell cat water_rights_visualizer/version.txt)

default:
	make install

version:
	$(info New Mexico Water Rights Visualizer version ${VERSION})

install-git-amazon-linux:
	sudo yum install -y git

install-mambaforge-amazon-linux:
	@if [ ! -d "$$HOME/mambaforge" ]; then \
		echo "Mambaforge not found. Installing..."; \
		curl -LO https://github.com/conda-forge/miniforge/releases/latest/download/Mambaforge-$$(uname)-$$(uname -m).sh; \
		sh ./Mambaforge-$$(uname)-$$(uname -m).sh -b; \
		$$HOME/mambaforge/condabin/conda init; \
		$$HOME/mambaforge/condabin/mamba init; \
		conda config --set auto_activate_base false; \
		rm ./Mambaforge-$$(uname)-$$(uname -m).sh; \
	else \
		echo "Mambaforge is already installed."; \
	fi

mamba:
ifeq ($(word 1,$(shell mamba --version)),mamba)
	@echo "mamba already installed"
else
	-conda deactivate; conda install -y -c conda-forge "mamba>=0.23"
endif

setup-scrollback-buffer:
	cp .screenrc ~

setup-data-directory-amazon-linux:
	sudo mkdir ~/data
	sudo setfacl -m u:ec2-user:rwx ~/data

install-docker-amazon-linux:
	@echo "Updating existing packages"
	sudo yum update -y
	@echo "Installing Docker"
	sudo amazon-linux-extras install docker -y
	@echo "Starting Docker service"
	sudo service docker start
	@echo "Adding the ec2-user to the docker group"
	sudo usermod -a -G docker ec2-user
	@echo "Installing Docker Compose"
	sudo curl -L https://github.com/docker/compose/releases/download/v2.24.7/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
	sudo chmod +x /usr/local/bin/docker-compose
	@echo "Docker and Docker Compose installed successfully"

create-blank-env:
	$(info creating blank water_rights environment)
	-conda run -n base mamba create -n water_rights

update-env-mamba:
	-mamba env update -n water_rights -f water_rights.yml
#	-conda run -n water_rights mamba env update --file water_rights.yml

environment:
	make mamba
	make create-blank-env
	make update-env-mamba

clean:
	$(info cleaning build)
	-rm -rvf build
	-rm -rvf dist
	-rm -rvf *.egg-info
	-rm -rvf CMakeFiles
	-rm CMakeCache.txt

uninstall:
	$(info uninstalling water_rights_visualizer package)
	-conda run -n water_rights pip uninstall water_rights_visualizer -y

setuptools:
	-conda run -n water_rights python setup.py install

install-package:
	$(info installing water_rights_visualizer package)
	-cp google_drive_key.txt water_rights_visualizer
	-make setuptools
	make clean
	make unit-tests f

install:
	-make environment
	make clean
	make uninstall
	make install-package

remove:
	mamba env remove -n water_rights

reinstall-hard:
	make remove
	make install

reinstall-soft:
	make uninstall
	make install-package

docker-build:
	-cp google_drive_key.txt water_rights_visualizer
	docker build -t water-rights-visualizer .

setup-amazon-linux:
	make install-git-amazon-linux
	make install-mambaforge-amazon-linux
	make install-docker-amazon-linux
	make setup-scrollback-buffer
	setup-data-directory-amazon-linux

update-local:
	cp .env.local .env
	./update.sh

update-jpl:
	cp .env.jpl-production .env
	./update.sh

update:
	cp .env.ose-production .env
	./update.sh

fix-mongo:
	docker exec -it water-rights-visualizer-mongo mongosh --eval "db.adminCommand({replSetReconfig: {_id: 'rs0', version: 1, members: [{_id: 0, host: 'water-rights-visualizer-mongo:27017'}]}, force: true})"

gdrive-credentials:
	@echo "Please paste the contents of your Google Drive credentials file (Ctrl-D to finish):";
	@cat > misc/water_rights_gdrive_creds.txt;
	@echo "Saving credentials to misc/water_rights_gdrive_creds.txt";

sync-openet:
	cd misc && pip install -r requirements.txt && python copy_openet_to_s3.py